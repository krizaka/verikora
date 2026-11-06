import type { Signal, SignalFamily } from "@verikora/core";
import { landlordSignals, signalFamily } from "@verikora/core";

import { activeConsents, CONSENT_PURPOSE, hasConsent } from "./applicant-consent";
import { LINK, linkState } from "./applicant-file-rules";
import { audit } from "./audit";
import { query } from "./db";
import { isUuid } from "./documents";
import { refuse } from "./http";
import { ANSWER_MAX, cleanAnswer } from "./signal-answer-rules";

/*
 * The applicant's answer to a trace found in their document (ADR-0014 §4, verikora#626). The person concerned is told which traces
 * were found and can add one short explanation per trace; the owner reads it next to the trace, dated. It is the person's own words:
 * kept with the document (deleted with it), never in an audit line (the line carries the signal id only).
 */

export { ANSWER_MAX, cleanAnswer };

export interface Answer {
  text: string;
  at: string;
}

/** A trace as the applicant reads it: facts about their own file, the engine's words, and their answer if they gave one. No box. */
export interface ApplicantSignal {
  id: string;
  level: string;
  observation: string;
  family: SignalFamily;
  evidence?: { page?: number; revision?: number; field?: string };
  answer: Answer | null;
}

/** Pure: the signals of an authenticity report, for the applicant, with the answers given (by signal id). */
export function applicantSignalsOf(
  report: { signals?: readonly Signal[] } | null | undefined,
  answers: ReadonlyMap<string, Answer>,
): ApplicantSignal[] {
  return (report?.signals ?? []).map((s) => {
    const { page, revision, field } = s.evidence ?? {};
    const evidence = { ...(page ? { page } : {}), ...(revision ? { revision } : {}), ...(field ? { field } : {}) };
    return {
      id: s.signalId,
      level: s.level,
      observation: s.observation,
      family: signalFamily(s),
      ...(Object.keys(evidence).length ? { evidence } : {}),
      answer: answers.get(s.signalId) ?? null,
    };
  });
}

/** The answers of some documents: document id → signal id → answer. */
export async function answersOf(documentIds: readonly string[]): Promise<Map<string, Map<string, Answer>>> {
  const out = new Map<string, Map<string, Answer>>();
  if (!documentIds.length) {
    return out;
  }
  const rows = await query<{ document_id: string; signal_id: string; explanation: string; answered_at: Date }>(
    "SELECT document_id, signal_id, explanation, answered_at FROM signal_answers WHERE document_id = ANY($1::uuid[])",
    [documentIds],
  );
  for (const r of rows) {
    const byDoc = out.get(r.document_id) ?? new Map<string, Answer>();
    byDoc.set(r.signal_id, { text: r.explanation, at: r.answered_at.toISOString() });
    out.set(r.document_id, byDoc);
  }
  return out;
}

/** The latest finished authenticity report of a document, or null. */
export async function authenticityReportOf(documentId: string): Promise<{ signals?: Signal[] } | null> {
  const [row] = await query<{ report: { signals?: Signal[] } | null }>(
    "SELECT report FROM analyses WHERE document_id = $1 AND studio = 'document-authenticity' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1",
    [documentId],
  );
  return row?.report
    ? { ...row.report, ...(row.report.signals ? { signals: landlordSignals(row.report.signals) } : {}) }
    : null;
}

export interface AnswerInput {
  documentId: string;
  signalId: string;
  text: string;
}

/**
 * Saves (or, with an empty text, removes) the answer to one trace of one document of the applicant's file. Allowed while the link
 * stands or was used (the owner has not decided), never after a revocation, an expiry, a decision or an erasure; needs the consent
 * to the check; the trace must be one the engine reported for that document. The audit line has ids, never the text.
 */
export async function answerSignal(
  link: {
    id: string;
    landlord_id: string;
    status: string;
    expires_at: Date;
    revoked_at: Date | null;
    submitted_at: Date | null;
    closed_at: Date | null;
  },
  input: AnswerInput,
  now: Date,
  headers?: Headers,
): Promise<{ answered: boolean }> {
  const state = linkState(link, now);
  if (state !== LINK.open && state !== LINK.used) {
    throw refuse(
      409,
      state === LINK.erased ? "APPLICATION_ERASED" : "ANSWER_CLOSED",
      "This file no longer takes answers",
    );
  }
  if (!hasConsent(await activeConsents(link.id), CONSENT_PURPOSE.DOCUMENT_CHECK)) {
    throw refuse(403, "CONSENT_REQUIRED", "The applicant has not consented to this purpose", {
      purpose: CONSENT_PURPOSE.DOCUMENT_CHECK,
    });
  }
  const text = cleanAnswer(input.text);
  if (text.length > ANSWER_MAX) {
    throw refuse(422, "ANSWER_TOO_LONG", "The explanation is too long", { max: ANSWER_MAX });
  }
  if (!isUuid(input.documentId)) {
    throw refuse(404, "SIGNAL_NOT_FOUND", "No such trace");
  }
  const [doc] = await query<{ id: string }>(
    "SELECT id FROM documents WHERE id = $1 AND screening_id = $2 AND owner_id = $3",
    [input.documentId, link.id, link.landlord_id],
  );
  const report = doc ? await authenticityReportOf(doc.id) : null;
  if (!doc || !report?.signals?.some((s) => s.signalId === input.signalId)) {
    throw refuse(404, "SIGNAL_NOT_FOUND", "No such trace");
  }
  if (text) {
    await query(
      "INSERT INTO signal_answers (document_id, signal_id, explanation, answered_at) VALUES ($1, $2, $3, $4) ON CONFLICT (document_id, signal_id) DO UPDATE SET explanation = EXCLUDED.explanation, answered_at = EXCLUDED.answered_at",
      [doc.id, input.signalId, text, now],
    );
  } else {
    await query("DELETE FROM signal_answers WHERE document_id = $1 AND signal_id = $2", [doc.id, input.signalId]);
  }
  await audit({
    action: text ? "signal.answered" : "signal.answer_removed",
    actorId: null,
    actorLabel: "applicant",
    targetId: link.id,
    detail: { document: doc.id, signal: input.signalId },
    headers,
  });
  return { answered: text.length > 0 };
}
