import { z } from "zod";

/**
 * Document forensics, slice 1 (krizaka-internal#6): what the bytes of a PDF say about how it was made. Pure functions, no I/O,
 * no model. Everything here is a signal read from the file, never a verdict: a report says « inconsistency found », it does not
 * say the document is false. Font, typography and payroll maths are the next slices; nothing of them is claimed here.
 */
export const ANOMALY_KINDS = ["incremental-update", "producer-changed", "producer-mismatch"] as const;
export const anomalyKind = z.enum(ANOMALY_KINDS);
export type AnomalyKind = z.infer<typeof anomalyKind>;

export const boundingBox = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

export const anomaly = z.object({
  kind: anomalyKind,
  /** 1-based page, or null when the finding is about the whole file. */
  page: z.number().int().positive().nullable(),
  /** Where it is on the page, null when it is about the whole file (the font slice fills it). */
  bbox: boundingBox.nullable(),
  evidence: z.string().min(1),
});
export type Anomaly = z.infer<typeof anomaly>;

export const fraudReport = z.object({
  /** 0 (nothing found) to 100. A signal for a person to look, not a probability of fraud. */
  tamperScore: z.number().int().min(0).max(100),
  anomalies: z.array(anomaly),
  revisions: z.number().int().min(1),
  producer: z.string().nullable(),
});
export type FraudReport = z.infer<typeof fraudReport>;

export type ForensicsDocumentKind = "payroll" | "other";
export interface ForensicsOptions {
  /** What the document claims to be. A producer is only judged against a kind that has an expected origin. */
  documentKind?: ForensicsDocumentKind;
}

export class NotAPdfError extends Error {
  constructor() {
    super("The file is not a PDF: no revision can be read.");
    this.name = "NotAPdfError";
  }
}

/** Consumer editors: software a person uses on a file, not what a payroll processor prints. Lowercase fragments. */
export const CONSUMER_EDITORS = ["canva", "photoshop", "ilovepdf", "sejda", "smallpdf", "pdfescape", "soda pdf", "sodapdf", "pdf24", "pdfcandy", "pdffiller", "pdf-xchange editor"] as const;
/** Payroll processors whose files are expected on a pay stub. Lowercase fragments. */
export const PAYROLL_PROCESSORS = ["adp", "ceridian", "dayforce", "desjardins", "workday", "payworks", "nethris", "ukg", "paycor"] as const;

// @fixed: weights of the score, one per kind of signal; they sum above 100 on purpose (capped).
const WEIGHTS = { "incremental-update": 35, "incremental-update-signed": 10, "producer-changed": 25, "producer-mismatch": 45 } as const;

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

function unescapeLiteral(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(Number.parseInt(c, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c;
  });
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes = Array.from({ length: padded.length / 2 }, (_, i) => Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    return out;
  }
  return String.fromCharCode(...bytes);
}

/** Every value given to a name like /Producer, in file order (an incremental update appends its own after the first). */
function stringValues(text: string, name: string): string[] {
  const out: { at: number; value: string }[] = [];
  const re = new RegExp(`/${name}\\s*(?:\\(((?:\\\\.|[^\\\\)])*)\\)|<([0-9A-Fa-f\\s]*)>)`, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ at: m.index, value: (m[1] === undefined ? decodeHex(m[2] ?? "") : unescapeLiteral(m[1])).trim() });
  }
  return out.filter((v) => v.value).map((v) => v.value);
}

const includesAny = (value: string | null, fragments: readonly string[]): string | null => {
  const lower = value?.toLowerCase() ?? "";
  return fragments.find((f) => lower.includes(f)) ?? null;
};

/** The number of saves the file carries: one %%EOF per revision; a linearized file legitimately has two for one revision. */
export function countRevisions(text: string): number {
  const eofs = (text.match(/%%EOF/g) ?? []).length;
  const linearized = /\/Linearized\b/.test(text.slice(0, 1024));
  return Math.max(1, linearized ? eofs - 1 : eofs);
}

export function analysePdf(bytes: Uint8Array, options: ForensicsOptions = {}): FraudReport {
  if (latin1(bytes.subarray(0, 5)) !== "%PDF-") throw new NotAPdfError();
  const text = latin1(bytes);
  const revisions = countRevisions(text);
  const producers = stringValues(text, "Producer");
  const first = producers[0] ?? null;
  const producer = producers.at(-1) ?? null;
  const anomalies: Anomaly[] = [];
  let score = 0;
  const add = (kind: AnomalyKind, weight: number, evidence: string) => {
    anomalies.push({ kind, page: null, bbox: null, evidence });
    score += weight;
  };

  if (revisions > 1) {
    // A digital signature is saved as an incremental update by design: it is a weaker signal there.
    const signed = /\/ByteRange\s*\[/.test(text);
    add("incremental-update", signed ? WEIGHTS["incremental-update-signed"] : WEIGHTS["incremental-update"], `The file was saved ${revisions} times: ${revisions - 1} change(s) were appended after the original.${signed ? " It carries a digital signature, which is saved that way too." : ""}`);
  }
  if (first && producer && first !== producer) add("producer-changed", WEIGHTS["producer-changed"], `The producing software changed between saves: "${first}" then "${producer}".`);
  if (options.documentKind === "payroll") {
    const editor = includesAny(producer, CONSUMER_EDITORS);
    if (editor && !includesAny(producer, PAYROLL_PROCESSORS)) add("producer-mismatch", WEIGHTS["producer-mismatch"], `A pay stub is expected from a payroll system; this file was produced by "${producer}", a general PDF editor.`);
  }
  return { tamperScore: Math.min(100, score), anomalies, revisions, producer };
}
