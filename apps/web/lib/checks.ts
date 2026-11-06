import type {
  Analysis,
  AnalysisStatus,
  Audience,
  DocumentKind,
  DocumentStatus,
  FlowEnvironment,
  StartAnalysis,
  Studio,
} from "@verikora/core";

import { storeForDocument } from "@/app/active-store";

import { overageBiller } from "../app/overage-biller";
import { getAnalysis, startAnalysis } from "./analyses";
import { type AuditVia, releaseAudit, reserveAudit } from "./billing";
import { query } from "./db";
import { documentStatus, isPhotoDocument } from "./documents";
import { resolveStart } from "./flows";
import { refuse } from "./http";
import type { Query } from "./organisation/store";
import { findReusableAnalysis, recordPreflight } from "./preflight-events";
import { capsFor } from "./prices/caps";
import { settingsFor } from "./settings/guards";

/**
 * One check started on one document, the single path every entry takes — the document page and a batch's rows
 * (verikora#232): the photo guard, the flow's decision (offered, consents), reuse of an identical result (no run, no audit),
 * the entitlement (free audit, credit or Pro; 402 PAYWALL otherwise), the run, and the audit given back if it cannot start.
 */
export type StartedCheck = { analysis: Analysis; reused: true } | { analysis: Analysis; reused: false; via: AuditVia };

export async function startCheck(
  account: { id: string; perspective: Audience | null },
  documentId: string,
  request: StartAnalysis,
  now: Date,
  environment: FlowEnvironment,
): Promise<StartedCheck> {
  if (request.studio === "document-authenticity" && (await isPhotoDocument(account.id, documentId))) {
    throw refuse(422, "PHOTO_AUTHENTICITY", "A document made from photos has no file of its own to examine");
  }
  const { flowVersionId } = await resolveStart(
    account,
    request.studio,
    environment,
    request.studio === "compliance-check" ? request.ruleset : undefined,
  );
  const settings = await settingsFor(account.id);
  const reusable = await findReusableAnalysis(query, {
    reuseDays: settings["limits.reuseDays"].value as number,
    now,
    ownerId: account.id,
    documentId,
    studio: request.studio,
    jurisdiction: request.studio === "compliance-check" ? request.jurisdiction : null,
    ruleset: request.studio === "compliance-check" ? (request.ruleset ?? null) : null,
    expectedIssuer: request.studio === "document-authenticity" ? (request.expectedIssuer ?? null) : null,
  });
  if (reusable) {
    await recordPreflight(query, account.id, "reused");
    return { analysis: await getAnalysis(account.id, documentId, reusable), reused: true };
  }
  const via = await reserveAudit(query, account.id, now, capsFor(settings, now), documentId, overageBiller());
  try {
    return {
      analysis: await startAnalysis(
        account.id,
        documentId,
        request,
        flowVersionId,
        via,
        await storeForDocument(account.id, documentId),
      ),
      reused: false,
      via,
    };
  } catch (error) {
    await releaseAudit(query, account.id, via, now, documentId, overageBiller());
    throw error;
  }
}

/** One check of the Vérifications list (the UX review's § 4.1): the document it read, what ran, how it ended, and its Sovkora run. */
export interface CheckSummary {
  id: string;
  documentId: string;
  title: string;
  kind: DocumentKind;
  studio: Studio;
  /** The run's state, then the report's own attention flag — Sovkora's answer in the library's words, never a verdict of Verikora's. */
  result: DocumentStatus;
  runId: string | null;
  /** When it finished, or started while it runs (ISO). */
  at: string;
}

interface CheckRow {
  id: string;
  document_id: string;
  title: string;
  kind: DocumentKind;
  studio: Studio;
  status: AnalysisStatus;
  attention: boolean;
  run_id: string | null;
  at: Date;
}

/** Every check of the owner, newest first — the Vérifications destination (filters in the address come with Y6). */
export async function listChecks(q: Query, owner: string, limit = 500): Promise<CheckSummary[]> {
  const rows = await q<CheckRow>(
    `SELECT a.id, a.document_id, d.title, d.kind, a.studio, a.status, coalesce((a.report->>'attention')::boolean, false) AS attention, a.run_id,
            coalesce(a.finished_at, a.created_at) AS at
       FROM analyses a JOIN documents d ON d.id = a.document_id
      WHERE d.owner_id = $1
      ORDER BY coalesce(a.finished_at, a.created_at) DESC, a.created_at DESC, d.title, a.studio, a.run_id NULLS LAST, a.id
      LIMIT $2`,
    [owner, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    title: r.title,
    kind: r.kind,
    studio: r.studio,
    result: documentStatus([{ status: r.status, attention: r.attention }]),
    runId: r.run_id,
    at: r.at.toISOString(),
  }));
}
