import crypto from "node:crypto";

import { type Analysis, type ComplianceReport, type DocumentDetail, isSeededCheck, textSource } from "@verikora/core";
import { z } from "zod";

import { type SigningKey } from "./report-key";
import { SITE_URL } from "./site";

/*
 * The audit report of a compliance check: a self-contained HTML file (print it to PDF from any browser) and what it
 * guarantees, exactly:
 *
 *   - the file carries an attestation: a canonical JSON `payload` (the document's SHA-256, the check — jurisdiction,
 *     rules version, Studio and its version, the Sovkora run id, the date — and every finding with its passage and
 *     article), the SHA-256 of the report's own visible text (`bodySha256`) and an Ed25519 signature over both;
 *   - a member the owner gave access to (ADR-0002) checks on /app/verifications/report that THIS server's key signed exactly this content
 *     and that not one byte of the file changed since; and, given the original document, that it is the one checked;
 *   - it does NOT prove the law was applied correctly (the Québec ruleset awaits a lawyer's review), that the run id
 *     exists on Sovkora's side (only its operator can say), or WHEN the report was made beyond the date the check
 *     finished: there is no independent time-stamp, no blockchain. The trust is in the key holder, Krizaka.
 *
 * Deterministic: the same stored check always gives the same bytes (no "generated now"), so the same signature.
 */

export const REPORT_SCHEMA = "verikora.report/1";

import { buildNote, closingNote, noteInputOf, noteSourceOf } from "./closing-note/build";
import { LINE, noteLines } from "./closing-note/render";
import { ruleExplanation, ruleTitle } from "./rule-text";

const payloadFinding = z.object({
  ruleId: z.string(),
  title: z.string().nullable(),
  severity: z.string(),
  verdict: z.string(),
  citation: z.string().nullable(),
  quote: z.string().nullable(),
  explanation: z.string(),
  method: z.string().nullable(),
});

export const reportPayload = z.object({
  schema: z.literal(REPORT_SCHEMA),
  lang: z.enum(["en", "fr"]),
  document: z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    filename: z.string(),
    title: z.string(),
    sizeBytes: z.number(),
    pages: z.number().nullable(),
    textSource: textSource.optional(),
  }),
  check: z.object({
    engine: z.literal("Sovkora"),
    studio: z.literal("compliance-check"),
    studioVersion: z.string().nullable(),
    runId: z.string(),
    jurisdiction: z.string(),
    asOf: z.string(),
    rulesetId: z.string(),
    rulesetVersion: z.string(),
    rulesetRevision: z.number().nullable(),
    reviewStatus: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string(),
  }),
  summary: z.object({
    rulesEvaluated: z.number(),
    blockingFailures: z.number(),
    byVerdict: z.record(z.string(), z.number()),
  }),
  findings: z.array(payloadFinding),
  /** « Ce que nous avons vérifié »: the closing note in plain words, signed with the rest (absent from reports issued before it existed). */
  note: closingNote.optional(),
  /** Set only by a demo key: a specimen is never an attestation, and verification rejects it (ADR-0002). */
  specimen: z.literal(true).optional(),
  /**
   * Set only on the sample report sent to a prospect (krizaka-internal#3119): a real run of the real pipeline on a fictitious file, signed with the
   * development key. Unlike a specimen it verifies — and says so on its first page, in the signed text (« Dossier fictif — démonstration »).
   */
  demo: z.literal(true).optional(),
});
export type ReportPayload = z.infer<typeof reportPayload>;

/** The words the report prints — taken from the messages (`report.*`) in the report's language, so the file stands alone. */
export type ReportLabels = Record<string, string>;

export class ReportError extends Error {}

/** A report's payload from a stored check. Only a finished compliance check with a run id and a report can be certified. */
export function buildPayload(
  doc: Pick<DocumentDetail, "sha256" | "filename" | "title" | "sizeBytes" | "pages" | "textSource">,
  analysis: Analysis,
  lang: "en" | "fr",
): ReportPayload {
  if (isSeededCheck(analysis)) throw new ReportError("A seeded demo check cannot be certified");
  if (
    analysis.studio !== "compliance-check" ||
    analysis.status !== "succeeded" ||
    !analysis.report ||
    !("findings" in analysis.report) ||
    !analysis.runId ||
    !analysis.finishedAt
  ) {
    throw new ReportError("Only a finished compliance check can be certified");
  }
  const report: ComplianceReport = analysis.report;
  const byVerdict: Record<string, number> = {};
  for (const f of report.findings) byVerdict[f.verdict] = (byVerdict[f.verdict] ?? 0) + 1;
  return {
    schema: REPORT_SCHEMA,
    lang,
    document: {
      sha256: doc.sha256,
      filename: doc.filename,
      title: doc.title,
      sizeBytes: doc.sizeBytes,
      pages: doc.pages,
      ...(doc.textSource ? { textSource: doc.textSource } : {}),
    },
    check: {
      engine: "Sovkora",
      studio: "compliance-check",
      studioVersion: analysis.blueprintVersion,
      runId: analysis.runId,
      jurisdiction: report.jurisdiction,
      asOf: report.asOf,
      rulesetId: report.rulesetId,
      rulesetVersion: report.rulesetVersion,
      rulesetRevision: report.rulesetRevision ?? null,
      reviewStatus: report.reviewStatus ?? null,
      startedAt: analysis.createdAt,
      finishedAt: analysis.finishedAt,
    },
    summary: {
      rulesEvaluated: report.summary?.rulesEvaluated ?? report.findings.length,
      blockingFailures:
        report.summary?.blockingFailures ??
        report.findings.filter((f) => f.verdict === "FAIL" && f.severity === "BLOCKING").length,
      byVerdict,
    },
    note: buildNote(noteInputOf(report, noteSourceOf(doc.textSource)), lang),
    findings: report.findings.map((f) => ({
      ruleId: f.ruleId,
      title: ruleTitle(f.ruleId, lang, f.title),
      severity: f.severity,
      verdict: f.verdict,
      citation: f.citation ?? null,
      quote: f.evidenceSpan?.quote ?? null,
      explanation: ruleExplanation(f.ruleId, lang, f.explanation, f.explanationEn),
      method: f.method ?? null,
    })),
  };
}

const compareKeys = (a: string, b: string) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** JSON with sorted keys and no whitespace: the one text a payload is signed as. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareKeys(a, b));
  const members = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${members.join(",")}}`;
}

export const sha256 = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** Where the attestation goes. The body is hashed with this marker removed, the file has the block in its place. */
export const ATTESTATION_MARKER = "<!--verikora-attestation-->";
const BLOCK = /<script type="application\/json" id="verikora-attestation">([^<]*)<\/script>/;

const CSS = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0 auto;max-width:52rem;padding:2rem 1.25rem;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#14161f;background:#fff}h1{font-size:1.6rem;margin:.2rem 0 .4rem}h2{font-size:1.1rem;margin:2rem 0 .6rem;border-bottom:1px solid #d6d9e2;padding-bottom:.3rem}.eyebrow{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#4b5163}dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:0}dt{color:#4b5163}dd{margin:0;overflow-wrap:anywhere}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.note{border:1px solid #d6d9e2;border-left:4px solid #6b5bd2;background:#f6f5fd;padding:.7rem .9rem;border-radius:6px;margin:1rem 0}.finding{border:1px solid #d6d9e2;border-radius:8px;padding:.8rem 1rem;margin:.7rem 0;break-inside:avoid}.finding h3{font-size:1rem;margin:0 0 .3rem;display:flex;justify-content:space-between;gap:1rem}.verdict{font-size:.8rem;font-weight:700;padding:.1rem .5rem;border-radius:99px;border:1px solid currentColor;white-space:nowrap}.v-PASS{color:#0b6b3a}.v-FAIL{color:#a1182b}.v-INSUFFICIENT_EVIDENCE{color:#8a5a00}blockquote{margin:.5rem 0;padding:.2rem .8rem;border-left:3px solid #b8bccb;color:#2b2f3d;font-style:italic}footer{margin-top:2.5rem;font-size:.85rem;color:#4b5163}@media print{body{padding:0}a{color:inherit}}`;

/** The closing note as HTML: the same lines the PDF prints. */
const NOTE_TAG = {
  [LINE.title]: "h2",
  [LINE.heading]: "h3",
  [LINE.text]: "p",
  [LINE.item]: "li",
  [LINE.note]: "p",
} as const;
function renderNote(note: NonNullable<ReportPayload["note"]>): string {
  const out: string[] = [];
  let list = false;
  for (const { kind, text } of noteLines(note)) {
    if (list && kind !== LINE.item) {
      out.push("</ul>");
      list = false;
    }
    if (kind === LINE.item && !list) {
      out.push("<ul>");
      list = true;
    }
    const tag = NOTE_TAG[kind];
    out.push(`<${tag}${kind === LINE.note ? ' class="note"' : ""}>${esc(text)}</${tag}>`);
  }
  if (list) out.push("</ul>");
  return `<section class="closing-note">\n${out.join("\n")}\n</section>`;
}

/** The report's HTML with the attestation marker where its block goes. Pure: payload and labels in, text out. */
export function renderBody(payload: ReportPayload, labels: ReportLabels): string {
  const c = payload.check;
  const d = payload.document;
  const pages = d.pages ? ` · ${d.pages} p.` : "";
  const studioVersion = c.studioVersion ? ` ${esc(c.studioVersion)}` : "";
  const revision = c.rulesetRevision !== null ? ` (rev. ${c.rulesetRevision})` : "";
  const row = (term: string, details: string) => `<dt>${esc(term)}</dt><dd>${details}</dd>`;
  const reviewNote = c.reviewStatus ? `<p class="note">${esc(labels.toReview)}</p>` : "";
  const contractNote =
    c.rulesetId === "qc-service-contract" ? `<p class="note">${esc(labels.notCheckedServiceContract)}</p>` : "";
  const sizeCell = `${d.sizeBytes} B${pages}`;
  const documentShaCell = `<code>${esc(d.sha256)}</code>`;
  const engineCell = `${esc(c.engine)} · ${esc(c.studio)}${studioVersion}`;
  const runIdCell = `<code>${esc(c.runId)}</code>`;
  const rulesetCell = `${esc(c.rulesetId)} · ${esc(c.rulesetVersion)}${revision}`;
  const verifyUrl = `${SITE_URL}/app/verifications/report`;
  const findings = payload.findings
    .map((f) => {
      const verdict = esc(labels[`verdict.${f.verdict}`] ?? f.verdict);
      const method = f.method ? ` · ${esc(f.method)}` : "";
      const ruleCell = `<code>${esc(f.ruleId)}</code> · ${esc(f.severity)}${method}`;
      const passage = f.quote ? `<blockquote>« ${esc(f.quote)} »</blockquote>` : esc(labels.noPassage);
      return `<section class="finding"><h3><span>${esc(f.title ?? f.ruleId)}</span><span class="verdict v-${esc(f.verdict)}">${verdict}</span></h3>
<p>${esc(f.explanation)}</p>
<dl>${row(labels.rule, ruleCell)}${f.citation ? row(labels.article, esc(f.citation)) : ""}${row(labels.passage, passage)}</dl></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="${payload.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(fill(labels.title, { name: d.title }))}</title>
<style>${CSS}</style>
</head>
<body>
<p class="eyebrow">${esc(labels.eyebrow)}</p>
<p class="note"><strong>${esc(labels.disclaimer)}</strong></p>
<p class="note">${esc(labels.languageNote)}</p>
<h1>${esc(d.title)}</h1>
<p>${esc(fill(labels.summary, { failures: payload.summary.blockingFailures, rules: payload.summary.rulesEvaluated }))}</p>
${reviewNote}
${contractNote}
<h2>${esc(labels.documentHeading)}</h2>
<dl>${row(labels.file, esc(d.filename))}${row(labels.size, sizeCell)}${row(labels.documentSha, documentShaCell)}</dl>
<h2>${esc(labels.checkHeading)}</h2>
<dl>${row(labels.engine, engineCell)}${row(labels.runId, runIdCell)}${row(labels.jurisdiction, esc(c.jurisdiction))}${row(labels.asOf, esc(c.asOf))}${row(labels.ruleset, rulesetCell)}${row(labels.model, esc(labels.modelValue))}${row(labels.started, esc(c.startedAt))}${row(labels.finished, esc(c.finishedAt))}</dl>
<h2>${esc(fill(labels.findingsHeading, { count: payload.findings.length }))}</h2>
${findings}
${payload.note ? renderNote(payload.note) : ""}
<h2>${esc(labels.guaranteeHeading)}</h2>
<p>${esc(labels.guarantees)}</p>
<p>${esc(labels.notGuaranteed)}</p>
<p>${esc(fill(labels.howToVerify, { url: verifyUrl }))}</p>
<footer>${esc(labels.footer)}</footer>
${ATTESTATION_MARKER}
</body>
</html>
`;
}

export interface Attestation {
  schema: typeof REPORT_SCHEMA;
  algorithm: "Ed25519";
  keyId: string;
  payload: ReportPayload;
  /** SHA-256 of the report's text with the attestation removed — what makes the visible words part of the signature. */
  bodySha256: string;
  /** base64 Ed25519 signature of `canonicalJson({ bodySha256, payload })`. */
  signature: string;
}

export const signedMessage = (payload: ReportPayload, bodySha256: string) =>
  Buffer.from(canonicalJson({ bodySha256, payload }), "utf8");

export interface IssuedReport {
  html: string;
  /** The SHA-256 of the file as delivered — the fingerprint to keep or pass along. */
  fileSha256: string;
  attestation: Attestation;
}

/** Renders, hashes and signs. The same payload, labels and key give the same bytes. */
export function issueReport(payload: ReportPayload, labels: ReportLabels, key: SigningKey): IssuedReport {
  const body = renderBody(payload, labels);
  const bodySha256 = sha256(body);
  const signature = crypto.sign(null, signedMessage(payload, bodySha256), key.privateKey).toString("base64");
  const attestation: Attestation = {
    schema: REPORT_SCHEMA,
    algorithm: "Ed25519",
    keyId: key.keyId,
    payload,
    bodySha256,
    signature,
  };
  // `<` is escaped so the JSON can never close its own script element; it parses back to the same value.
  const json = JSON.stringify(attestation).replaceAll("<", String.raw`\u003c`);
  const block = `<script type="application/json" id="verikora-attestation">${json}</script>`;
  const html = body.replace(ATTESTATION_MARKER, block);
  return { html, fileSha256: sha256(html), attestation };
}

export type ReportVerifyFailure =
  "NOT_A_REPORT" | "UNREADABLE" | "BAD_SIGNATURE" | "ALTERED" | "UNKNOWN_KEY" | "SPECIMEN";

export type Verification =
  | { ok: true; fileSha256: string; keyId: string; payload: ReportPayload; documentMatch: boolean | null }
  | { ok: false; reason: ReportVerifyFailure; fileSha256: string };

/**
 * Checks a report file against a public key (and, optionally, the original document's bytes). Never throws on hostile
 * input: a file that is not a report, is cut, or has been edited anywhere — a word of a finding, the run id, the
 * document hash, a space — fails with a reason.
 */
export function verifyReport(
  file: string,
  key: Pick<SigningKey, "keyId" | "publicKey">,
  document?: Uint8Array | null,
): Verification {
  const fileSha256 = sha256(file);
  const fail = (reason: ReportVerifyFailure): Verification => ({ ok: false, reason, fileSha256 });
  // A pasted text may arrive with CRLF line ends; our files never contain a CR.
  const text = file.includes("\r") ? file.replaceAll("\r\n", "\n") : file;
  const match = BLOCK.exec(text);
  if (!match) return fail("NOT_A_REPORT");
  let attestation: Attestation;
  try {
    const raw = z
      .object({
        schema: z.literal(REPORT_SCHEMA),
        algorithm: z.literal("Ed25519"),
        keyId: z.string(),
        payload: reportPayload,
        bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
        signature: z.string(),
      })
      .parse(JSON.parse(match[1]!));
    attestation = raw as Attestation;
  } catch {
    return fail("UNREADABLE");
  }
  if (attestation.keyId !== key.keyId) return fail("UNKNOWN_KEY");
  const signed = crypto.verify(
    null,
    signedMessage(attestation.payload, attestation.bodySha256),
    key.publicKey,
    Buffer.from(attestation.signature, "base64"),
  );
  if (!signed) return fail("BAD_SIGNATURE");
  // The signature is good for this payload and this body hash: the file must still BE that body.
  const body = text.replace(match[0], ATTESTATION_MARKER);
  if (sha256(body) !== attestation.bodySha256) return fail("ALTERED");
  // A specimen is a demonstration, never an attestation: however valid its signature, it proves nothing.
  if (attestation.payload.specimen) return fail("SPECIMEN");
  return {
    ok: true,
    fileSha256,
    keyId: attestation.keyId,
    payload: attestation.payload,
    documentMatch: document ? sha256(document) === attestation.payload.document.sha256 : null,
  };
}
