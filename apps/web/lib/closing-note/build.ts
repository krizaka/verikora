import {
  type AuthenticityReport,
  type ClosingNote,
  type ComplianceReport,
  TEXT_SOURCE,
  type TextSource,
} from "@verikora/core";

import { pluralKey } from "../plural";
import { authenticityData, type Bilingual, compliancePackOf, say, template } from "./data";
import {
  FINDING_STATE,
  type FindingState,
  type Lang,
  NOTE_KIND,
  NOTE_SOURCE,
  type NoteKind,
  type NoteSource,
  SEVERITY_ORDER,
  SIGNAL_LEVEL,
  SIGNAL_LEVELS_ORDERED,
  VERDICT,
} from "./vocabulary";

/** The note's shape is a contract the apps read too: it lives in `@verikora/core`. */
export { type ClosingNote, closingNote } from "@verikora/core";

export interface FindingInput {
  ruleId: string;
  title?: string | null;
  severity: string;
  verdict: string;
  method?: string | null;
  explanation?: string | null;
}
export interface SignalInput {
  signalId: string;
  level: string;
  observation: string;
  mayIndicate?: string | null;
}
/** How the document's text was read, when it was not a text layer: a photo read by character recognition (with its reliability) or by a model. */
export type TextSourceInput = { kind: "ocr"; confidence: number; lowConfidence: boolean } | { kind: "vision" };
export type NoteInput =
  | {
      kind: typeof NOTE_KIND.compliance;
      rulesetId: string;
      asOf: string;
      reviewStatus?: string | null;
      findings: readonly FindingInput[];
      textSource?: TextSourceInput | null;
    }
  | {
      kind: typeof NOTE_KIND.authenticity;
      notExamined?: string | readonly string[] | null;
      signals: readonly SignalInput[];
    };

const REVIEW_PENDING = "TO_REVIEW_BY_LAWYER";
const DETERMINISTIC = "DETERMINISTIC";

const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const line = (key: string, lang: Lang, vars: Record<string, string | number> = {}) =>
  fill(say(template(key), lang), vars);
/** The singular or plural form of a template, by its count (`okOne`, `okMany`). */
const counted = (base: string, count: number, lang: Lang, vars: Record<string, string | number> = {}) =>
  line(pluralKey(base, count), lang, { count, ...vars });
const heading = (key: string, lang: Lang) =>
  say((template("headings") as unknown as Record<string, Bilingual>)[key]!, lang);
const sentences = (key: string, lang: Lang) => (template(key) as unknown as Bilingual[]).map((t) => say(t, lang));

/** « 22 octobre 2026 »: the date of the rules, in the reader's language. */
const longDate = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(say((template("dates") as unknown as Record<string, Bilingual>).locale!, lang), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

const stateOf = (verdict: string): FindingState => {
  if (verdict === VERDICT.pass) {
    return FINDING_STATE.ok;
  }
  if (verdict === VERDICT.notApplicable) {
    return FINDING_STATE.skipped;
  }
  return verdict === VERDICT.fail ? FINDING_STATE.attention : FINDING_STATE.undecided;
};
const rank = (severity: string) => {
  const i = SEVERITY_ORDER.indexOf(severity);
  return i === -1 ? SEVERITY_ORDER.length : i;
};

function frame(
  lang: Lang,
  kind: NoteKind,
  parts: Pick<ClosingNote, "what" | "how" | "notChecked" | "result" | "next"> & { reviewPending: string | null },
): ClosingNote {
  return {
    lang,
    kind,
    title: say(template("title"), lang),
    ...parts,
    decides: { heading: heading("decides", lang), text: line("decides", lang) },
    disclaimer: line("disclaimer", lang),
  };
}

type Pack = ReturnType<typeof compliancePackOf>;
type ComplianceInput = Extract<NoteInput, { kind: "compliance" }>;
type Findings = { ok: FindingInput[]; failed: FindingInput[]; undecided: FindingInput[] };
type NextItem = ClosingNote["next"]["items"][number];

const isImportant = (f: FindingInput) => f.severity === SEVERITY_ORDER[0];

/** What was checked: the pack's own words, or the fallback when the ruleset is not one of the packs. */
function whatTextOf(pack: Pack, input: ComplianceInput, lang: Lang): string {
  const what = pack ? say(pack.what, lang) : line("whatFallback", lang);
  const date = longDate(input.asOf, lang);
  if (!pack) {
    return line("unknownPack", lang, { what, pack: input.rulesetId });
  }
  const scope = say(pack.scope, lang);
  return input.findings.length === 1
    ? line("whatComplianceOne", lang, { what, scope, date })
    : line("whatCompliance", lang, { what, count: input.findings.length, scope, date });
}

/** How the check was made, with the way the text was read when it was a photo. */
function howSentencesOf(input: ComplianceInput, lang: Lang): string[] {
  const src = input.textSource;
  const photo = src
    ? [
        src.kind === TEXT_SOURCE.vision
          ? line("howPhotoModel", lang)
          : line(src.lowConfidence ? "howPhotoLow" : "howPhoto", lang, { confidence: Math.round(src.confidence) }),
      ]
    : [];
  const model = input.findings.some((f) => f.method && f.method !== DETERMINISTIC) ? [line("howModel", lang)] : [];
  return [...sentences("how", lang), ...photo, ...model];
}

/** What the check does not cover: the pack's limits, a photo's reading, the rules that could not be decided. */
function notCheckedOf(pack: Pack, input: ComplianceInput, undecided: readonly FindingInput[], lang: Lang): string[] {
  const packLimits = pack?.notChecked.map((t) => say(t, lang)) ?? [];
  const photo = input.textSource ? [line("notCheckedPhoto", lang)] : [];
  const open = undecided.length
    ? [
        counted("undecidedList", undecided.length, lang, {
          titles: undecided.map((f) => f.title ?? f.ruleId).join(", "),
        }),
      ]
    : [];
  return [...packLimits, ...photo, ...open];
}

/** The one-sentence result: all fine, or the counts of what is fine, needs attention (blocking) and is undecided. */
function resultTextOf({ ok, failed, undecided }: Findings, lang: Lang): string {
  if (failed.length === 0 && undecided.length === 0) {
    return counted("allFine", ok.length, lang);
  }
  const important = failed.filter(isImportant);
  const attention = [
    counted("attention", failed.length, lang),
    important.length ? counted("blocking", important.length, lang) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const parts = [
    ok.length ? counted("ok", ok.length, lang) : null,
    failed.length ? attention : null,
    undecided.length ? counted("undecided", undecided.length, lang) : null,
  ];
  return `${line("resultLead", lang)}${parts.filter(Boolean).join(", ")}.`;
}

/** What to do next: the failed findings by severity, then the undecided ones. */
function nextItemsOf(pack: Pack, { failed, undecided }: Findings, lang: Lang): NextItem[] {
  const failedItems = [...failed]
    .sort((a, b) => rank(a.severity) - rank(b.severity) || a.ruleId.localeCompare(b.ruleId))
    .map((f): NextItem => {
      const p = pack?.rules[f.ruleId];
      return {
        problem: p ? say(p.attention, lang) : (f.explanation ?? f.title ?? f.ruleId),
        advice: p ? say(p.advice, lang) : line("adviceFallback", lang, { title: f.title ?? f.ruleId }),
        important: isImportant(f),
        source: p ? NOTE_SOURCE.pack : NOTE_SOURCE.report,
      };
    });
  const undecidedItems = undecided.map((f): NextItem => {
    const unknown = pack?.unknown[f.ruleId];
    return {
      problem: unknown ? say(unknown, lang) : (f.explanation ?? f.title ?? f.ruleId),
      advice: line("adviceUndecided", lang, { title: f.title ?? f.ruleId }),
      important: false,
      source: (unknown ? NOTE_SOURCE.pack : NOTE_SOURCE.report) as NoteSource,
    };
  });
  return [...failedItems, ...undecidedItems];
}

function complianceNote(input: ComplianceInput, lang: Lang): ClosingNote {
  const pack = compliancePackOf(input.rulesetId);
  const by = (state: FindingState) => input.findings.filter((f) => stateOf(f.verdict) === state);
  const grouped: Findings = {
    ok: by(FINDING_STATE.ok),
    failed: by(FINDING_STATE.attention),
    undecided: by(FINDING_STATE.undecided),
  };
  const items = nextItemsOf(pack, grouped, lang);

  return frame(lang, NOTE_KIND.compliance, {
    what: { heading: heading("what", lang), text: whatTextOf(pack, input, lang) },
    how: { heading: heading("how", lang), sentences: howSentencesOf(input, lang) },
    notChecked: { heading: heading("notChecked", lang), items: notCheckedOf(pack, input, grouped.undecided, lang) },
    result: { heading: heading("result", lang), text: resultTextOf(grouped, lang) },
    next: { heading: heading("next", lang), items, none: items.length ? null : line("nothingToDo", lang) },
    reviewPending: input.reviewStatus === REVIEW_PENDING ? line("reviewPending", lang) : null,
  });
}

function authenticityNote(input: Extract<NoteInput, { kind: "authenticity" }>, lang: Lang): ClosingNote {
  const counts = Object.fromEntries(
    SIGNAL_LEVELS_ORDERED.map((level) => [level, input.signals.filter((s) => s.level === level).length]),
  );
  const parts = SIGNAL_LEVELS_ORDERED.filter((level) => counts[level]).map((level) =>
    counted(level, counts[level]!, lang),
  );
  const notExamined = input.notExamined ? [input.notExamined].flat().filter(Boolean) : [];
  const attention = [...input.signals]
    .filter((s) => s.level !== SIGNAL_LEVEL.observed)
    .sort((a, b) => SIGNAL_LEVELS_ORDERED.indexOf(b.level as never) - SIGNAL_LEVELS_ORDERED.indexOf(a.level as never));
  const items = attention.map((s) => ({
    problem: s.observation,
    advice: say(authenticityData.advice[s.level] ?? authenticityData.advice[SIGNAL_LEVEL.unusual]!, lang),
    important: s.level === SIGNAL_LEVEL.incoherent,
    source: NOTE_SOURCE.report as NoteSource,
  }));
  return frame(lang, NOTE_KIND.authenticity, {
    what: {
      heading: heading("what", lang),
      text: line("whatAuthenticity", lang, { what: say(authenticityData.what, lang) }),
    },
    how: { heading: heading("how", lang), sentences: sentences("howAuthenticity", lang) },
    notChecked: {
      heading: heading("notChecked", lang),
      items: [...authenticityData.notChecked.map((t) => say(t, lang)), ...notExamined],
    },
    result: {
      heading: heading("result", lang),
      text: parts.length
        ? `${line("resultLead", lang)}${counted("signals", input.signals.length, lang)} : ${parts.join(", ")}.`
        : line("authenticityNone", lang),
    },
    next: { heading: heading("next", lang), items, none: items.length ? null : line("nothingToDo", lang) },
    reviewPending: null,
  });
}

/** The note's input from a report as Sovkora returned it (a compliance report has findings, an authenticity report has signals). */
export function noteInputOf(
  report: ComplianceReport | AuthenticityReport,
  textSource?: TextSourceInput | null,
): NoteInput {
  if ("findings" in report) {
    return {
      kind: NOTE_KIND.compliance,
      rulesetId: report.rulesetId,
      asOf: report.asOf,
      reviewStatus: report.reviewStatus,
      findings: report.findings.map((f) => ({
        ruleId: f.ruleId,
        title: f.title,
        severity: f.severity,
        verdict: f.verdict,
        method: f.method,
        explanation: f.explanation,
      })),
      textSource: textSource ?? null,
    };
  }
  return { kind: NOTE_KIND.authenticity, notExamined: report.notExamined, signals: report.signals };
}

/** What the note needs of a document's text source (a PDF or a text file has none). */
export function noteSourceOf(source: TextSource | null | undefined): TextSourceInput | null {
  if (!source) {
    return null;
  }
  return source.kind === TEXT_SOURCE.vision
    ? { kind: TEXT_SOURCE.vision }
    : { kind: TEXT_SOURCE.ocr, confidence: source.confidence, lowConfidence: source.lowConfidence };
}

export function buildNote(input: NoteInput, lang: Lang): ClosingNote {
  return input.kind === NOTE_KIND.compliance ? complianceNote(input, lang) : authenticityNote(input, lang);
}

export { AUTHENTICITY_PACK } from "./vocabulary";
