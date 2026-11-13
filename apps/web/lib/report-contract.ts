import {
  type AuthenticityReport,
  type ComplianceReport,
  landlordSignals,
  reportOf,
  type RunArtefact,
  type Studio,
} from "@verikora/core";

import runSchema from "./sovkora-contract/compliance-check-run.schema.json";
import { type SchemaNode, schemaViolations } from "./sovkora-contract/schema-check";

/*
 * « Signals, never a verdict » on the model's own words (krizaka-internal#3378). One place, pure, at the read of a run's output and before any
 * page: the report is shown only if (1) it is the pinned schema, (2) every passage it cites is in the stored text, (3) no refused word appears.
 * A report that fails is a coded failure, never a page.
 *
 * What the engine already guarantees (sovkora `packs/document-validation/worker/quotes.py`, `citations.py`, ADR-087 §3): a quote is kept only when
 * the text it comes from says it, compared on one normal form; a citation is VERIFIED only against the article the ruleset pins. Verikora does not
 * redo the pack's law checks (the citation's article is the pack's); it re-checks what it receives against the text it stored, with the same normal form.
 */

export const REPORT_CODE = {
  schema: "REPORT_SCHEMA",
  citation: "REPORT_CITATION",
  wording: "REPORT_WORDING",
} as const;
export type ReportCode = (typeof REPORT_CODE)[keyof typeof REPORT_CODE];
export const isReportCode = (v: string | null | undefined): v is ReportCode =>
  Object.values(REPORT_CODE).includes(v as ReportCode);

/** The languages a refused-word list is kept in (the admin screen and the API share them; this module reaches no database). */
export const REFUSED_LANGUAGES = ["fr", "en"] as const;
export type RefusedLanguage = (typeof REFUSED_LANGUAGES)[number];
export type RefusedWords = Record<RefusedLanguage, string[]>;

export type ReportOutputs = readonly { key: string; value?: string | null }[];
export type ReportCheck =
  { ok: true; report: ComplianceReport | AuthenticityReport } | { ok: false; code: ReportCode; detail: string };

const DOUBLE_QUOTES = /[«»“”„‟″]/g;
const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DASHES = /[‐‑‒–—―−]/g;
const SPACES = /\s+/g;

/** The pack's normal form (`quotes.normalise`): NFC, case folded, curly quotes straight, œ/æ spelled out, dashes to -, one space, none inside French quotation marks. */
export function normaliseQuote(text: string): string {
  const s = (text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replaceAll("œ", "oe")
    .replaceAll("æ", "ae")
    .replaceAll("…", "...")
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replace(DASHES, "-")
    .replace(SPACES, " ");
  return s.replaceAll('" ', '"').replaceAll(' "', '"').trim();
}

/** Whether a quote is a passage of the text on that normal form; an empty quote is never found. */
export function quoteIsIn(text: string, quote: string): boolean {
  const needle = normaliseQuote(quote);
  return needle !== "" && normaliseQuote(text).includes(needle);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a refused word or phrase appears as whole words in a sentence (accents and case ignored). */
export function containsWord(sentence: string, word: string): boolean {
  const needle = fold(word).trim();
  if (!needle) {
    return false;
  }
  const phrase = escape(needle).replace(/\s+/g, String.raw`\s+`);
  const pattern = String.raw`(?<![\p{L}\p{N}])` + phrase + String.raw`(?![\p{L}\p{N}])`;
  return new RegExp(pattern, "u").test(fold(sentence));
}

/** The bounds of an entry of the refused-word list: one word or a short phrase (at most 4 words, 2 to 40 characters, letters, digits, spaces, apostrophe and hyphen). */
// @fixed: a phrase longer than this is a sentence, which no model's wording ever repeats exactly
const MAX_WORDS = 4;
// @fixed: the column's own bound
const MAX_LENGTH = 40;
export function validateRefusedWord(input: string): { ok: true; word: string } | { ok: false; reason: string } {
  if (/\p{C}/u.test(input)) {
    return { ok: false, reason: "shape" };
  }
  const word = input.trim().replace(SPACES, " ").toLowerCase();
  if (word.length < 2 || word.length > MAX_LENGTH || input.length > MAX_LENGTH * 2) {
    return { ok: false, reason: "length" };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u.test(word) || word.split(" ").length > MAX_WORDS) {
    return { ok: false, reason: "shape" };
  }
  return { ok: true, word };
}

function parse(outputs: ReportOutputs, key: string): unknown {
  const value = outputs.find((o) => o.key === key)?.value;
  try {
    const raw = typeof value === "string" ? (JSON.parse(value) as unknown) : undefined;
    return raw && typeof raw === "object" && "report" in raw ? (raw as { report: unknown }).report : raw;
  } catch {
    return undefined;
  }
}

/** A 2.x report (it names its `contract`) must be Sovkora's pinned report schema; an UNSUPPORTED_KIND / KIND_UNKNOWN one has no finding by design. */
function pinnedViolations(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || !("contract" in raw)) {
    return [];
  }
  const schema = structuredClone(runSchema.$defs.report) as SchemaNode;
  if ((raw as { outcome?: unknown }).outcome !== "CHECKED" && schema.properties?.findings) {
    schema.properties.findings.minItems = 0;
  }
  return schemaViolations(raw, schema, "report");
}

/** Every passage a compliance report cites from the document: a finding's evidence and the evidence of each figure it read. */
function passages(report: ComplianceReport): string[] {
  const out: string[] = [];
  for (const f of report.findings) {
    if (f.evidenceSpan) {
      out.push(f.evidenceSpan.quote);
    }
  }
  for (const fact of Object.values(report.facts ?? {})) {
    if ("evidenceSpan" in fact && fact.evidenceSpan) {
      out.push(fact.evidenceSpan.quote);
    }
  }
  return out;
}

/** What the model wrote in its own words (never the document's passages it quotes back). */
function sentences(report: ComplianceReport | AuthenticityReport): string[] {
  if ("findings" in report) {
    return report.findings.flatMap((f) => [f.title ?? "", f.explanation, f.explanationEn ?? ""]);
  }
  return landlordSignals(report.signals).flatMap((s) => [
    s.observation,
    s.mayIndicate ?? "",
    s.where ?? "",
    s.askFor ?? "",
  ]);
}

export function checkReportOutput(input: {
  studio: Studio;
  outputs: ReportOutputs;
  documentText: string;
  refusedWords: readonly string[];
}): ReportCheck {
  const { studio, outputs, documentText, refusedWords } = input;
  const key = studio === "compliance-check" ? "report" : "signals";
  const violations = studio === "compliance-check" ? pinnedViolations(parse(outputs, key)) : [];
  const report = reportOf(studio, outputs as readonly RunArtefact[]);
  if (!report || violations.length > 0) {
    return { ok: false, code: REPORT_CODE.schema, detail: violations[0] ?? "the report is not the schema's shape" };
  }
  if ("findings" in report) {
    const missing = passages(report).find((quote) => !quoteIsIn(documentText, quote));
    if (missing !== undefined) {
      return { ok: false, code: REPORT_CODE.citation, detail: "a cited passage is not in the document" };
    }
  }
  const words = sentences(report);
  const refused = refusedWords.find((word) => words.some((s) => containsWord(s, word)));
  if (refused !== undefined) {
    return { ok: false, code: REPORT_CODE.wording, detail: `a refused word appears: ${refused}` };
  }
  return { ok: true, report };
}
