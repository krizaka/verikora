import { DOCX_MIME, ODT_MIME, type StartAnalysis } from "@verikora/core";

import { isReportCode } from "./report-contract";

/*
 * A check that did not finish (krizaka-internal#1900). Pure (no database, no clock): the client reads it too.
 * The engine's own sentence is never shown (it names the engine and a run); the person reads what happened to THEIR file, in plain
 * words, and a way out. Each real cause has a message per file type and at least one recovery action.
 */

/** What went wrong, from the person's side. */
export const FAILURE_CAUSES = ["unreadable", "refused", "interrupted", "unreliable"] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

/** The families of file a message is written for. */
export const FILE_FAMILIES = ["pdf", "scan", "office", "text", "other"] as const;
export type FileFamily = (typeof FILE_FAMILIES)[number];

/** The ways out; « retry » and « chooseFile » are offered for every cause. */
export type RecoveryAction = "retry" | "chooseFile";
export const RECOVERY: Record<FailureCause, readonly RecoveryAction[]> = {
  unreadable: ["chooseFile", "retry"],
  refused: ["chooseFile", "retry"],
  interrupted: ["retry", "chooseFile"],
  unreliable: ["retry", "chooseFile"],
};

/** The code a stored failure starts with when the report failed the contract (`REPORT_SCHEMA: …`), else null. */
export function reportCodeOf(error: string | null | undefined): string | null {
  return /^(REPORT_[A-Z]+)\b/.exec(error ?? "")?.[1] ?? null;
}

/*
 * The codes Sovkora's workers answer a failed step with (krizaka-internal#3411): `error` is the exception type name or a
 * reason of a closed set, never a sentence. The run carries it as `errorMessage`. A code of the input set says the file or
 * the request was refused; a code of the document set says the file could not be read; any other code (EXECUTOR_FAULT, an
 * exception type, a code this list does not know yet) is the engine's own fault and degrades to « interrupted ».
 */
const REFUSED_CODES: ReadonlySet<string> = new Set([
  "INPUT_INVALID",
  "NOT_CHECKABLE",
  "UNKNOWN_JURISDICTION",
  "UNKNOWN_RULESET",
  "FIELD_NOT_JSON",
  "AS_OF_NOT_ISO",
  "NO_RULESET_FOR_DATE",
  "TEXT_TOO_LONG",
]);
const UNREADABLE_CODES: ReadonlySet<string> = new Set(["DOCUMENT_UNREADABLE", "DOCUMENT_MISSING", "TEXT_MISSING"]);

/** The cause a Sovkora failure code stands for, or null when the text holds none: a whole upper-case word, never a part of one. */
function codedCauseOf(error: string): FailureCause | null {
  for (const word of error.match(/(?<!\w)[A-Z][A-Z0-9_]*(?!\w)/g) ?? []) {
    if (REFUSED_CODES.has(word)) return "refused";
    if (UNREADABLE_CODES.has(word)) return "unreadable";
  }
  return null;
}

/** The cause of a stored failure (`analyses.error`): Sovkora's code first, then the sentences `refresh` writes and older runs kept. */
export function causeOf(error: string | null | undefined): FailureCause {
  const text = (error ?? "").toLowerCase();
  if (isReportCode(reportCodeOf(error))) {
    return "unreliable";
  }
  const coded = codedCauseOf(error ?? "");
  if (coded) {
    return coded;
  }
  if (text.includes("without a report")) {
    return "unreadable";
  }
  if (/\b(refused|rejected|invalid|schema|400|422)\b/.test(text)) {
    return "refused";
  }
  return "interrupted";
}

/** The family of a file: a PDF with no text layer is a scan, said as such. */
export function familyOf({ mimeType, hasText }: Readonly<{ mimeType: string; hasText: boolean }>): FileFamily {
  if (mimeType === "application/pdf") {
    return hasText ? "pdf" : "scan";
  }
  if (mimeType === DOCX_MIME || mimeType === ODT_MIME) {
    return "office";
  }
  if (mimeType.startsWith("text/")) {
    return "text";
  }
  return "other";
}

/** The « no text » message of each family (`console.document.noText.*`): it names the file's real type, « this file » when it is none of ours. */
const NO_TEXT_KEY: Record<FileFamily, string> = {
  pdf: "pdf",
  scan: "pdf",
  office: "office",
  text: "text",
  other: "other",
};

/** The key of the message that says a file has no text to check, from its media type. */
export function noTextKeyOf(mimeType: string): string {
  return `document.noText.${NO_TEXT_KEY[familyOf({ mimeType, hasText: true })]}`;
}

/** The message key (under `console.checkFailure`) and the actions for a failure: the cause says why, the family says it for this file. */
export function failureOf(
  error: string | null | undefined,
  file: Readonly<{ mimeType: string; hasText: boolean }>,
): { cause: FailureCause; family: FileFamily; key: string; actions: readonly RecoveryAction[] } {
  const cause = causeOf(error);
  const family = familyOf(file);
  const code = reportCodeOf(error);
  // A report that failed the contract says which of the three checks it failed, whatever the file's type.
  const key = isReportCode(code) ? `checkFailure.report.${code}` : `checkFailure.${cause}.${family}`;
  return { cause, family, key, actions: RECOVERY[cause] };
}

/** The request that runs a failed check again: the same Studio and the same ruleset it was started with, on the day of the retry. */
export function retryRequest(
  failed: Readonly<{ studio: string; inputs: Readonly<Record<string, string>> }>,
  asOf: string,
): StartAnalysis {
  if (failed.studio === "document-authenticity") {
    return { studio: "document-authenticity" };
  }
  return {
    studio: "compliance-check",
    jurisdiction: "QC",
    asOf,
    ...(failed.inputs.ruleset ? { ruleset: failed.inputs.ruleset } : {}),
  };
}
