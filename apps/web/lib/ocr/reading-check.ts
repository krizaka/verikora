import { TEXT_SOURCE } from "@verikora/core";

import type { OcrRules, TextSource } from "./port";

/**
 * The reading gate (ADR VER-019, decision 3): deterministic, the host's. A document read from an image (OCR, or a PDF made of
 * images whose stray text is a few characters) is checked on its CONTENT before any rule runs on it: enough text, no flag from the
 * engine, every labelled amount of a receipt found and the amounts adding up to the cent. The engine's confidence is never enough
 * alone and a figure is never corrected. It is a consistency signal, not a proof: the document keeps « read from a photo ».
 */
export const READING_FAILURE = {
  tooLittle: "TOO_LITTLE_TEXT",
  lowConfidence: "LOW_CONFIDENCE",
  amountsMissing: "AMOUNTS_MISSING",
  totalsDoNotAdd: "TOTALS_DO_NOT_ADD",
} as const;
export type ReadingFailure = (typeof READING_FAILURE)[keyof typeof READING_FAILURE];

const AMOUNT = /(?<![\d.,])\d{1,3}(?:[\s,]\d{3})*[.,]\d{2}(?![\d%]|\s*%)/;
const LABEL = {
  subtotal: /sub-?total|sous-?total/i,
  total: /\btotal\b|montant d[ûu]/i,
  tax: /\b(?:tps|tvq|gst|qst|hst|pst|tvh|tax(?:e|es)?|vat)\b/i,
};
const cents = (raw: string): number => {
  const digits = raw.replace(/[\s,.]/g, "");
  return Number.parseInt(digits, 10);
};

/** The amount a label stands for: the first figure on its own line, else on the next non-empty line (a column read apart). */
function valueOf(lines: readonly string[], at: number): number | null {
  for (const line of [lines[at], lines.slice(at + 1).find((l) => l.trim() !== "")]) {
    const found = line?.match(AMOUNT)?.[0];
    if (found) return cents(found);
  }
  return null;
}

interface Labelled {
  kind: keyof typeof LABEL;
  value: number | null;
}

function labelled(text: string): Labelled[] {
  const lines = text.split("\n");
  const out: Labelled[] = [];
  lines.forEach((line, at) => {
    const kind = (Object.keys(LABEL) as (keyof typeof LABEL)[]).find((k) => LABEL[k].test(line));
    // « Total » inside « Subtotal » is the subtotal; a long sentence that merely says « tax » is prose, not a figure line.
    if (kind && line.trim().length <= 60) out.push({ kind, value: valueOf(lines, at) });
  });
  return out;
}

function arithmeticProblem(text: string): ReadingFailure | null {
  const rows = labelled(text);
  if (rows.length === 0) return null;
  if (rows.some((r) => r.value === null)) return READING_FAILURE.amountsMissing;
  const one = (kind: Labelled["kind"]) => rows.filter((r) => r.kind === kind).map((r) => r.value as number);
  const [subtotal] = one("subtotal");
  const total = one("total").at(-1);
  if (subtotal === undefined || total === undefined) return null;
  const sum = subtotal + one("tax").reduce((a, b) => a + b, 0);
  return Math.abs(sum - total) > 1 ? READING_FAILURE.totalsDoNotAdd : null;
}

/** Why the text of this document cannot be trusted for a check, or null when it can (or when it is a text layer, which is not second-guessed). */
export function readingProblem(
  doc: { text: string; source: TextSource | null | undefined; mimeType: string },
  rules: OcrRules,
): ReadingFailure | null {
  const fromImage = doc.source != null;
  if (!fromImage && doc.mimeType !== "application/pdf") return null;
  if (!fromImage && doc.text.trim().length > rules.minChars) return null;
  if (doc.text.replace(/\s/g, "").length < rules.minChars) return READING_FAILURE.tooLittle;
  if (doc.source?.kind === TEXT_SOURCE.ocr && doc.source.lowConfidence) return READING_FAILURE.lowConfidence;
  return fromImage ? arithmeticProblem(doc.text) : null;
}
