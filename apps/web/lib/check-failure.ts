import { DOCX_MIME, ODT_MIME, type StartAnalysis } from "@verikora/core";

/*
 * A check that did not finish (krizaka-internal#1900). Pure (no database, no clock): the client reads it too.
 * The engine's own sentence is never shown (it names the engine and a run); the person reads what happened to THEIR file, in plain
 * words, and a way out. Each real cause has a message per file type and at least one recovery action.
 */

/** What went wrong, from the person's side. */
export const FAILURE_CAUSES = ["unreadable", "refused", "interrupted"] as const;
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
};

/** The cause of a stored failure (`analyses.error`): the sentences `refresh` writes and the engine's own. */
export function causeOf(error: string | null | undefined): FailureCause {
  const text = (error ?? "").toLowerCase();
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
  return { cause, family, key: `checkFailure.${cause}.${family}`, actions: RECOVERY[cause] };
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
