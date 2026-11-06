import { pool, query } from "./db";
import { budgetLimit } from "./operations-shared";
import { signingKey } from "./report-signer";

export { budgetLimit, usageShare } from "./operations-shared";

/** What an operator reads to know whether the service is well: pool and database connections, the queue, errors, the signing key, the rulesets. */

export interface PoolUsage {
  /** The pool's ceiling (the budget this process may use). */
  max: number;
  total: number;
  idle: number;
  waiting: number;
}

export function poolUsage(): PoolUsage {
  const p = pool();
  return { max: p.options.max ?? 10, total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount };
}

export interface DatabaseBudget {
  /** Connections open on this database right now, from every client. */
  open: number;
  /** What the role may open: its own limit when it has one, else the server's `max_connections`. */
  limit: number;
}

/** The connections used against the budget of the role (a small managed cluster has few: this is the number to watch). */
export async function databaseBudget(): Promise<DatabaseBudget> {
  const [row] = await query<{ open: string; role_limit: number; server_limit: string }>(
    `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS open,
            (SELECT rolconnlimit FROM pg_roles WHERE rolname = current_user) AS role_limit,
            current_setting('max_connections') AS server_limit`,
  );
  return { open: Number(row?.open ?? 0), limit: budgetLimit(row?.role_limit ?? -1, Number(row?.server_limit ?? 0)) };
}

export interface Queue {
  byStatus: Record<string, number>;
  /** Runs still `running` after more than `stuckMinutes` — Sovkora may have lost them. */
  stuck: number;
  stuckMinutes: number;
  oldestRunningMinutes: number | null;
}

export async function queue(stuckMinutes = 10): Promise<Queue> {
  const rows = await query<{ status: string; n: string }>("SELECT status, count(*) AS n FROM analyses GROUP BY status");
  const [r] = await query<{ stuck: string; oldest: number | null }>(
    "SELECT count(*) FILTER (WHERE created_at < now() - make_interval(mins => $1)) AS stuck, extract(epoch FROM now() - min(created_at)) / 60 AS oldest FROM analyses WHERE status = 'running'",
    [stuckMinutes],
  );
  return {
    byStatus: Object.fromEntries(rows.map((x) => [x.status, Number(x.n)])),
    stuck: Number(r?.stuck ?? 0),
    stuckMinutes,
    oldestRunningMinutes: r?.oldest == null ? null : Math.round(r.oldest),
  };
}

export interface RecentError {
  at: string;
  kind: "run" | "sign-in";
  detail: string;
  target: string | null;
}

/** The latest failures: runs that failed (with Sovkora's message) and refused sign-ins, newest first. */
export async function recentErrors(limit = 20): Promise<RecentError[]> {
  const runs = await query<{ at: Date; studio: string; error: string | null; id: string }>(
    "SELECT coalesce(finished_at, created_at) AS at, studio, error, id FROM analyses WHERE status = 'failed' ORDER BY 1 DESC LIMIT $1",
    [limit],
  );
  const refusals = await query<{ at: Date; detail: { reason?: string }; target_id: string | null }>(
    "SELECT at, detail, target_id FROM audit.entry WHERE action = 'auth.sign_in_refused' ORDER BY at DESC LIMIT $1",
    [limit],
  );
  return [
    ...runs.map((r): RecentError => ({
      at: r.at.toISOString(),
      kind: "run",
      detail: `${r.studio}: ${r.error ?? "—"}`,
      target: r.id,
    })),
    ...refusals.map((r): RecentError => ({
      at: r.at.toISOString(),
      kind: "sign-in",
      detail: r.detail.reason ?? "refused",
      target: r.target_id,
    })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

export interface RulesetUse {
  rulesetId: string;
  rulesetVersion: string;
  jurisdiction: string;
  checks: number;
  lastAt: string;
}

/** Which rulesets the checks really ran against (read from the reports Sovkora returned), and how often. */
export async function rulesetsInUse(): Promise<RulesetUse[]> {
  const rows = await query<{
    id: string | null;
    version: string | null;
    jurisdiction: string | null;
    n: string;
    last: Date;
  }>(
    `SELECT report->>'rulesetId' AS id, report->>'rulesetVersion' AS version, report->>'jurisdiction' AS jurisdiction, count(*) AS n, max(created_at) AS last
       FROM analyses WHERE studio = 'compliance-check' AND report IS NOT NULL GROUP BY 1, 2, 3 ORDER BY n DESC`,
  );
  return rows.map((r) => ({
    rulesetId: r.id ?? "—",
    rulesetVersion: r.version ?? "—",
    jurisdiction: r.jurisdiction ?? "—",
    checks: Number(r.n),
    lastAt: r.last.toISOString(),
  }));
}

/** The id of the key that signs reports (never the key): `development` when it is the public development key. */
export function signingKeyId(): { keyId: string; development: boolean } {
  const { keyId } = signingKey();
  return { keyId, development: keyId.startsWith("dev:") };
}
