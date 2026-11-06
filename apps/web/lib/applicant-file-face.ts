import { type Analysis, ANALYSIS_STATUS } from "@verikora/core";
import { z } from "zod";

import { LINK, type LinkState, NOT_NECESSARY_TYPES } from "./applicant-file-rules";
import { verdictOf } from "./document-face";

/*
 * What « Dossiers » shows of an applicant file (verikora#323, design § 4): its link's state as a line of facts and the
 * documents received against those asked. Pure: the state comes from `linkState` (lib/applicant-file-rules); the words are
 * messages. There is no decision here yet (P7, krizaka-ts#89).
 */

export interface LinkFact {
  /** The message (`dossiers.link.<state>`), with `{date}` when the state has one. */
  key: `dossiers.link.${LinkState}`;
  date?: string;
  /** Waiting on the applicant is `accent` (design § 3.4); every other state is `neutral` — a closed link is no fault. */
  tone: "accent" | "neutral";
}

/** The link's state in words: open until its expiry, sent on its day, closed on its day; expired, revoked or erased. */
export function linkFact(file: {
  status: LinkState;
  expiresAt: string;
  submittedAt: string | null;
  closedAt: string | null;
}): LinkFact {
  const key = `dossiers.link.${file.status}` as const;
  if (file.status === LINK.open) return { key, date: file.expiresAt, tone: "accent" };
  if (file.status === LINK.used && file.submittedAt) return { key, date: file.submittedAt, tone: "neutral" };
  if (file.status === LINK.closed && file.closedAt) return { key, date: file.closedAt, tone: "neutral" };
  return { key, tone: "neutral" };
}

/** The documents in, against those asked: « 2 sur 3 », « aucun sur 2 », « 3 sur 3 ». */
export function documentsFact(
  count: number,
  asked: number,
): {
  key: "dossiers.documents.none" | "dossiers.documents.some" | "dossiers.documents.all";
  count: number;
  asked: number;
} {
  const enough = count >= asked ? "dossiers.documents.all" : "dossiers.documents.some";
  return { key: count === 0 ? "dossiers.documents.none" : enough, count, asked };
}

/** The catalogue's types a manager may ask for: never one of the minimisation list, whatever the catalogue holds (Loi 25). */
export const requestableTypes = <T extends { id: string }>(types: readonly T[]): T[] =>
  types.filter((t) => !NOT_NECESSARY_TYPES.includes(t.id));

/** The request's shape, as `POST /api/applications` reads it: the minimisation rule stays the service's (`requestedTypes`), so the API answers its precise 422 TYPE_NOT_NECESSARY. */
export const applicantRequestBody = z.object({
  candidateName: z.string().trim().min(1).max(120),
  candidateEmail: z.string().trim().toLowerCase().email().max(254),
  types: z.array(z.string().min(2).max(40)).min(1).max(10),
});

/**
 * « Demander des documents »: the form's schema — the same body, and a type of the minimisation list refused before it
 * leaves. The browser and the server refuse the same requests; the service keeps its own rule, so no route can skip it.
 */
export const applicantRequest = applicantRequestBody.extend({
  types: applicantRequestBody.shape.types.refine((types) => !types.some((t) => NOT_NECESSARY_TYPES.includes(t)), {
    message: "TYPE_NOT_NECESSARY",
  }),
});
export type ApplicantRequest = z.infer<typeof applicantRequest>;

export interface CheckFact {
  key:
    | "dossiers.check.attention"
    | "dossiers.check.nothing"
    | "dossiers.check.signals"
    | "dossiers.check.noSignal"
    | "dossiers.check.running"
    | "dossiers.check.failed";
  count: number;
  tone: "danger" | "warning" | "success" | "neutral";
}

/** A received document's check, in words, from what Sovkora returned: never a grade of the person, never Verikora's own verdict. */
export function checkFact(check: Pick<Analysis, "studio" | "status" | "report">): CheckFact {
  if (check.status === ANALYSIS_STATUS.running) return { key: "dossiers.check.running", count: 0, tone: "neutral" };
  const report = check.report;
  if (check.status !== ANALYSIS_STATUS.succeeded || !report)
    return { key: "dossiers.check.failed", count: 0, tone: "neutral" };
  if ("findings" in report) {
    const v = verdictOf(report);
    return v.attention
      ? { key: "dossiers.check.attention", count: v.attention, tone: v.tone }
      : { key: "dossiers.check.nothing", count: 0, tone: "success" };
  }
  if ("signals" in report) {
    const count = report.signals.filter((s) => s.level !== "observé").length;
    return count
      ? { key: "dossiers.check.signals", count, tone: "warning" }
      : { key: "dossiers.check.noSignal", count: 0, tone: "success" };
  }
  return { key: "dossiers.check.failed", count: 0, tone: "neutral" };
}

/** The address the applicant opens (the token is returned once by the request; only its hash is kept). Its page: app/[locale]/dossier/[token] (verikora#341). */
export const applicantLink = (origin: string, locale: "en" | "fr", token: string): string =>
  `${origin}/${locale}/dossier/${token}`;

/** The requestable types with their words, from the applicant's catalogue (`applicantFile.types`); a type without words keeps its id. */
export const askableTypes = (
  words: Readonly<Record<string, { label: string } | undefined>>,
  types: readonly { id: string }[],
): { id: string; label: string }[] =>
  requestableTypes(types).map((t) => ({ id: t.id, label: words[t.id]?.label ?? t.id }));
