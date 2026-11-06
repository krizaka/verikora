import type { QueryResultRow } from "pg";

import type { PreflightOutcome } from "./preflight/port";

/**
 * The application side of the pre-flight (ADR-0005): the outcomes kept for the metrics, and the reuse of a result Verikora
 * already holds. A refused file and a reused result are Sovkora runs that did not happen; the estimated cost of one run is
 * configuration (`APP_ESTIMATED_RUN_COST_CENTS`) and the figures are labelled as an estimate.
 */
type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

export async function recordPreflight(
  query: Query,
  accountId: string,
  outcome: PreflightOutcome["kind"],
  reason: string | null = null,
): Promise<void> {
  await query("INSERT INTO preflight_events (account_id, outcome, reason) VALUES ($1, $2, $3)", [
    accountId,
    outcome,
    reason,
  ]);
}

export interface PreflightMetrics {
  tenantId: string | null;
  accepted: number;
  rejected: number;
  reused: number;
  runsAvoided: number;
  estimatedSavedCents: number;
}

export async function preflightMetrics(query: Query, estimatedRunCostCents: number): Promise<PreflightMetrics[]> {
  const rows = await query<{ account_id: string | null; accepted: string; rejected: string; reused: string }>(
    `SELECT account_id,
            count(*) FILTER (WHERE outcome = 'accepted') AS accepted,
            count(*) FILTER (WHERE outcome = 'rejected') AS rejected,
            count(*) FILTER (WHERE outcome = 'reused') AS reused
       FROM preflight_events GROUP BY account_id ORDER BY count(*) DESC LIMIT 200`,
  );
  return rows.map((r) => {
    const avoided = Number(r.rejected) + Number(r.reused);
    return {
      tenantId: r.account_id,
      accepted: Number(r.accepted),
      rejected: Number(r.rejected),
      reused: Number(r.reused),
      runsAvoided: avoided,
      estimatedSavedCents: avoided * estimatedRunCostCents,
    };
  });
}

/**
 * A result already held: the same document (a tenant keeps one row per SHA-256), the same Studio, the same rules (jurisdiction,
 * ruleset, expected issuer) under the Studio version now in force. Returns the analysis id of the newest such run.
 * A deleted document takes its analyses with it (ON DELETE CASCADE): a purged document is never reused.
 */
export async function findReusableAnalysis(
  query: Query,
  p: {
    reuseDays: number;
    now: Date;
    ownerId: string;
    documentId: string;
    studio: string;
    jurisdiction: string | null;
    ruleset: string | null;
    expectedIssuer: string | null;
  },
): Promise<string | null> {
  if (p.reuseDays <= 0) return null; // reuse switched off
  const [current] = await query<{ blueprint_version: string }>(
    "SELECT blueprint_version FROM analyses WHERE studio = $1 AND blueprint_version IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [p.studio],
  );
  if (!current) return null;
  const [row] = await query<{ id: string }>(
    `SELECT a.id FROM analyses a JOIN documents d ON d.id = a.document_id
      WHERE d.owner_id = $1 AND d.id = $2 AND a.studio = $3 AND a.status = 'succeeded' AND a.run_id IS NOT NULL AND a.blueprint_version = $4 AND a.created_at >= $8::timestamptz - make_interval(days => $9)
        AND COALESCE(a.inputs->>'jurisdiction', '') = $5 AND COALESCE(a.inputs->>'ruleset', '') = $6 AND COALESCE(a.inputs->>'expectedIssuer', '') = $7
      ORDER BY a.created_at DESC LIMIT 1`,
    [
      p.ownerId,
      p.documentId,
      p.studio,
      current.blueprint_version,
      p.jurisdiction ?? "",
      p.ruleset ?? "",
      p.expectedIssuer ?? "",
      p.now,
      p.reuseDays,
    ],
  );
  return row?.id ?? null;
}
