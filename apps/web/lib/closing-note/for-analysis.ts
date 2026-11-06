import type { Analysis } from "@verikora/core";

import { buildNote, type ClosingNote, noteInputOf } from "./build";
import type { Lang } from "./vocabulary";

/** The plain-language closing note of a finished analysis, for the apps; nothing while it runs or when it has no report. */
export function closingNoteOf(analysis: Pick<Analysis, "report">, lang: Lang): ClosingNote | null {
  return analysis.report ? buildNote(noteInputOf(analysis.report), lang) : null;
}
