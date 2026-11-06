import { CONSENT_PURPOSE, type ConsentPurpose, LINK, type LinkState } from "./applicant-file-rules";
import { HttpError } from "./http";
import type { ApplicantSignal } from "./signal-answers";

/*
 * What the applicant's page shows (verikora#341), pure: the types are the request's and no others, the drop opens only once
 * the applicant consented to the check, and a link that is not open says why (the codes of `applicantFile.error`). The
 * routes keep their own rules (`assertOpen`, `requireConsent`): the page never decides what the API refuses, it only avoids
 * offering what would be refused.
 */

/** The state `applicantFileState` returns (lib/applicant-file.ts), as the page reads it. */
export interface ApplicantFileState {
  status: LinkState;
  expiresAt: string;
  types: { id: string; fields: string[]; retentionPolicy: string }[];
  documents: { id: string; typeId: string | null; filename: string; sizeBytes: number; signals: ApplicantSignal[] }[];
}

export type ClosedCode = "LINK_REVOKED" | "LINK_EXPIRED" | "LINK_USED" | "FILE_CLOSED" | "APPLICATION_ERASED";

const CLOSED_BECAUSE: Record<Exclude<LinkState, "open">, ClosedCode> = {
  revoked: "LINK_REVOKED",
  expired: "LINK_EXPIRED",
  used: "LINK_USED",
  closed: "FILE_CLOSED",
  erased: "APPLICATION_ERASED",
};

export interface ApplicantPage {
  link: LinkState;
  open: boolean;
  /** The reason a link is not open (a code of `applicantFile.error`), or null. */
  closedBecause: ClosedCode | null;
  /** The types asked, in the request's order, each with what was received of it. */
  rows: { typeId: string; documents: ApplicantFileState["documents"] }[];
  /** Upload is offered on an open link, once the check is consented to. */
  canUpload: boolean;
  /** Submission needs an open link and at least one document. */
  canSubmit: boolean;
  /** A withdrawal and an erasure are always allowed, until the file is erased. */
  canWithdraw: boolean;
  /** An explanation of a trace is taken while the link stands or was used, with the consent to the check (ADR-0014, verikora#626). */
  canAnswer: boolean;
  consent: { check: boolean; keep: boolean };
}

export function applicantPageOf(state: ApplicantFileState, consents: readonly ConsentPurpose[]): ApplicantPage {
  const open = state.status === LINK.open;
  const check = consents.includes(CONSENT_PURPOSE.DOCUMENT_CHECK);
  return {
    link: state.status,
    open,
    closedBecause: state.status === LINK.open ? null : CLOSED_BECAUSE[state.status],
    rows: state.types.map((t) => ({ typeId: t.id, documents: state.documents.filter((d) => d.typeId === t.id) })),
    canUpload: open && check,
    canSubmit: open && check && state.documents.length > 0,
    canWithdraw: state.status !== LINK.erased,
    canAnswer: check && (open || state.status === LINK.used),
    consent: { check, keep: consents.includes(CONSENT_PURPOSE.DOCUMENT_KEEP) },
  };
}

export interface ApplicantPageDeps {
  fileByToken: (token: string) => Promise<{ id: string }>;
  applicantFileState: (token: string, now: Date) => Promise<ApplicantFileState>;
  activeConsents: (applicationId: string) => Promise<ConsentPurpose[]>;
}

/** The page's data by link: null when no applicant file answers to the token (unknown, or a screening's — it has its own page). */
export async function loadApplicantPage(
  token: string,
  now: Date,
  deps: ApplicantPageDeps,
): Promise<{ state: ApplicantFileState; consents: ConsentPurpose[] } | null> {
  try {
    const row = await deps.fileByToken(token);
    const [state, consents] = await Promise.all([deps.applicantFileState(token, now), deps.activeConsents(row.id)]);
    return { state, consents };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
