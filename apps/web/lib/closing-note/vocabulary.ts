/** The closed sets of the closing note: one word for each idea, shared by the builder, the data and the tests. */
export const LANG = { fr: "fr", en: "en" } as const;
export type Lang = (typeof LANG)[keyof typeof LANG];
export const LANGS = Object.values(LANG);

/** How a finding came out in Sovkora's report (the verdicts of the packs). */
export const VERDICT = {
  pass: "PASS",
  fail: "FAIL",
  undecided: "INSUFFICIENT_EVIDENCE",
  notApplicable: "NOT_APPLICABLE",
} as const;

/** How much a failed rule matters, most important first. */
export const SEVERITY = { blocking: "BLOCKING", major: "MAJOR", advisory: "ADVISORY" } as const;
export const SEVERITY_ORDER: readonly string[] = [SEVERITY.blocking, SEVERITY.major, SEVERITY.advisory];

/** What the note says about a finding. */
export const FINDING_STATE = { ok: "ok", attention: "attention", undecided: "undecided", skipped: "skipped" } as const;
export type FindingState = (typeof FINDING_STATE)[keyof typeof FINDING_STATE];

export { NOTE_KIND, NOTE_SOURCE, type NoteKind, type NoteSource } from "@verikora/core";

/** The levels Sovkora gives a signal of the authenticity check, mildest first. */
export const SIGNAL_LEVEL = { observed: "observé", unusual: "inhabituel", incoherent: "incohérent" } as const;
export const SIGNAL_LEVELS_ORDERED = [SIGNAL_LEVEL.observed, SIGNAL_LEVEL.unusual, SIGNAL_LEVEL.incoherent] as const;

/** The check that has no rules pack: the PDF's own traces. */
export const AUTHENTICITY_PACK = "document-authenticity";
