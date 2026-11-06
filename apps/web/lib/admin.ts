import { PAGE } from "@krizaka/audit";

import { audit, trail } from "./audit";
import { query } from "./db";
import { isUuid } from "./documents";
import { refuse } from "./http";

/** What the administration console reads: counts, accounts, the audit trail, documents (metadata only), Sovkora runs. */

export interface Overview {
  accounts: number;
  admins: number;
  suspended: number;
  documents: number;
  bytes: number;
  runs: Record<string, number>;
  lastRunAt: string | null;
}

export async function overview(): Promise<Overview> {
  const [a] = await query<{ accounts: string; admins: string; suspended: string }>(
    "SELECT count(*) AS accounts, count(*) FILTER (WHERE role = 'ADMIN') AS admins, count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended FROM accounts",
  );
  const [d] = await query<{ documents: string; bytes: string | null }>(
    "SELECT count(*) AS documents, sum(size_bytes) AS bytes FROM documents",
  );
  const runs = await query<{ status: string; n: string }>("SELECT status, count(*) AS n FROM analyses GROUP BY status");
  const [last] = await query<{ at: Date | null }>("SELECT max(created_at) AS at FROM analyses");
  return {
    accounts: Number(a?.accounts ?? 0),
    admins: Number(a?.admins ?? 0),
    suspended: Number(a?.suspended ?? 0),
    documents: Number(d?.documents ?? 0),
    bytes: Number(d?.bytes ?? 0),
    runs: Object.fromEntries(runs.map((r) => [r.status, Number(r.n)])),
    lastRunAt: last?.at?.toISOString() ?? null,
  };
}

export interface AdminDocument {
  id: string;
  title: string;
  owner: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  analyses: number;
  /** Declared a sample (non-personal): the only kind the public showcase may show. */
  sample: boolean;
  createdAt: string;
}

export async function allDocuments(): Promise<AdminDocument[]> {
  const rows = await query<{
    id: string;
    title: string;
    owner: string;
    kind: string;
    mime_type: string;
    size_bytes: number;
    analyses: string;
    sample: boolean;
    created_at: Date;
  }>(
    `SELECT d.id, d.title, a.email AS owner, d.kind, d.mime_type, d.size_bytes, d.sample, d.created_at,
            (SELECT count(*) FROM analyses x WHERE x.document_id = d.id) AS analyses
       FROM documents d JOIN accounts a ON a.id = d.owner_id ORDER BY d.created_at DESC LIMIT 500`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    owner: r.owner,
    kind: r.kind,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    analyses: Number(r.analyses),
    sample: r.sample,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface AdminRun {
  id: string;
  studio: string;
  status: string;
  runId: string | null;
  document: string;
  owner: string;
  durationSeconds: number | null;
  error: string | null;
  /** The public showcase's check. */
  showcase: boolean;
  /** Can be promoted: a finished compliance check on a document declared a sample. */
  showable: boolean;
  createdAt: string;
}

/** Duration of a run from its row: finished − created, null while it runs. */
export const durationSeconds = (created: Date, finished: Date | null) =>
  finished ? Math.max(0, Math.round((finished.getTime() - created.getTime()) / 1000)) : null;

export async function allRuns(): Promise<AdminRun[]> {
  const rows = await query<{
    id: string;
    studio: string;
    status: string;
    run_id: string | null;
    title: string;
    email: string;
    error: string | null;
    showcase: boolean;
    sample: boolean;
    created_at: Date;
    finished_at: Date | null;
  }>(
    `SELECT x.id, x.studio, x.status, x.run_id, d.title, a.email, x.error, x.showcase, d.sample, x.created_at, x.finished_at
       FROM analyses x JOIN documents d ON d.id = x.document_id JOIN accounts a ON a.id = d.owner_id
      ORDER BY x.created_at DESC LIMIT 500`,
  );
  return rows.map((r) => ({
    id: r.id,
    studio: r.studio,
    status: r.status,
    runId: r.run_id,
    document: r.title,
    owner: r.email,
    durationSeconds: durationSeconds(r.created_at, r.finished_at),
    error: r.error,
    showcase: r.showcase,
    showable: r.sample && r.studio === "compliance-check" && r.status === "succeeded",
    createdAt: r.created_at.toISOString(),
  }));
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
}

/**
 * The newest entries of the trail (`@krizaka/audit`'s `list`, a page at a time). With an id: every entry that person did or that was
 * about them — the package filters a target by its kind and its id, and this reads by the id alone (krizaka-ts gap), so that case reads `audit.entry` itself.
 */
export async function auditLog(limit = 300, targetId?: string): Promise<AuditEntry[]> {
  if (targetId) {
    const rows = await query<{
      id: string;
      at: Date;
      actor_label: string;
      action: string;
      target_id: string | null;
      ip: string | null;
    }>(
      "SELECT id, at, actor_label, action, target_id, ip FROM audit.entry WHERE target_id = $2 OR actor_id::text = $2 ORDER BY at DESC, id DESC LIMIT $1",
      [limit, targetId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      at: r.at.toISOString(),
      actor: r.actor_label,
      action: r.action,
      target: r.target_id,
      ip: r.ip,
    }));
  }
  const entries: Awaited<ReturnType<typeof trail.list>> = [];
  while (entries.length < limit) {
    const page = await trail.list(query, {
      limit: Math.min(PAGE.max, limit - entries.length),
      before: entries.at(-1)?.id,
    });
    entries.push(...page);
    if (page.length < PAGE.max) break;
  }
  return entries.map((e) => ({
    id: e.id,
    at: e.at.toISOString(),
    actor: e.actorLabel,
    action: e.action,
    target: e.targetId,
    ip: e.ip,
  }));
}

export interface UserDetail {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  plan: "FREE" | "PRO";
  createdAt: string;
  lastSeenAt: string | null;
  documents: number;
  sessions: number;
}

export async function userDetail(id: string): Promise<UserDetail> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such account");
  const [r] = await query<{
    id: string;
    email: string;
    role: "USER" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED";
    plan: "FREE" | "PRO";
    created_at: Date;
    last_seen_at: Date | null;
    documents: string;
    sessions: string;
  }>(
    `SELECT a.id, a.email, a.role, a.status, a.plan, a.created_at, a.last_seen_at,
            (SELECT count(*) FROM documents d WHERE d.owner_id = a.id) AS documents,
            (SELECT count(*) FROM sessions s WHERE s.account_id = a.id AND s.expires_at > now()) AS sessions
       FROM accounts a WHERE a.id = $1`,
    [id],
  );
  if (!r) throw refuse(404, "NOT_FOUND", "No such account");
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    plan: r.plan,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    documents: Number(r.documents),
    sessions: Number(r.sessions),
  };
}

/** Suspends (every session ends at once) or restores an account. An administrator never suspends their own account. */
export async function setUserStatus(
  actor: { id: string; email: string },
  id: string,
  status: "ACTIVE" | "SUSPENDED",
  headers?: Headers,
): Promise<UserDetail> {
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such account");
  if (status === "SUSPENDED" && id === actor.id)
    throw refuse(409, "SELF_SUSPEND", "You cannot suspend your own account");
  const rows = await query("UPDATE accounts SET status = $2 WHERE id = $1 RETURNING id", [id, status]);
  if (rows.length === 0) throw refuse(404, "NOT_FOUND", "No such account");
  if (status === "SUSPENDED") await query("DELETE FROM sessions WHERE account_id = $1", [id]);
  await audit({
    action: status === "SUSPENDED" ? "admin.user_suspended" : "admin.user_restored",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: id,
    headers,
  });
  return userDetail(id);
}

/** Who may be given which role: a pure rule, so the route and the tests share it. */
export function roleChangeRefusal(
  actorId: string,
  targetId: string,
  to: "USER" | "ADMIN",
  adminsLeft: number,
  currentRole: "USER" | "ADMIN",
): { code: string; message: string } | null {
  if (to === currentRole) return null;
  if (actorId === targetId) return { code: "SELF_ROLE", message: "You cannot change your own role" };
  if (currentRole === "ADMIN" && to === "USER" && adminsLeft <= 1)
    return { code: "LAST_ADMIN", message: "The last administrator keeps the role" };
  return null;
}

/** Grants or withdraws the ADMIN role. Never on yourself, never on the last administrator. Sessions stay (the role is read at each request). */
export async function setUserRole(
  actor: { id: string; email: string },
  id: string,
  to: "USER" | "ADMIN",
  headers?: Headers,
): Promise<UserDetail> {
  const current = await userDetail(id);
  const [{ n }] = await query<{ n: string }>(
    "SELECT count(*) AS n FROM accounts WHERE role = 'ADMIN' AND status = 'ACTIVE'",
  );
  const refusal = roleChangeRefusal(actor.id, id, to, Number(n), current.role);
  if (refusal) throw refuse(409, refusal.code, refusal.message);
  if (to !== current.role) {
    await query("UPDATE accounts SET role = $2 WHERE id = $1", [id, to]);
    await audit({
      action: "admin.user_role_changed",
      actorId: actor.id,
      actorLabel: actor.email,
      targetId: id,
      detail: { from: current.role, to },
      headers,
    });
  }
  return userDetail(id);
}

/** The plan an administrator may set by hand, and where: a QA account has no card, so only a development environment accepts it (verikora#252). */
export function planChangeRefusal(environment: "dev" | "prod"): { code: string; message: string } | null {
  return environment === "prod"
    ? {
        code: "PLAN_BY_HAND_IN_PRODUCTION",
        message: "A plan is set by hand in a development environment only; in production it follows the subscription",
      }
    : null;
}

/** Puts an account on Pro without a card (a live subscription row with no end), or back on Free. Audited; refused in production. */
export async function setUserPlan(
  actor: { id: string; email: string },
  id: string,
  to: "FREE" | "PRO",
  environment: "dev" | "prod",
  headers?: Headers,
): Promise<UserDetail> {
  const refusal = planChangeRefusal(environment);
  if (refusal) throw refuse(403, refusal.code, refusal.message);
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such account");
  const [before] = await query<{ plan: string }>("SELECT plan FROM accounts WHERE id = $1", [id]);
  if (!before) throw refuse(404, "NOT_FOUND", "No such account");
  await query(
    to === "PRO"
      ? "UPDATE accounts SET plan = 'PRO', subscription_status = 'active', current_period_end = NULL WHERE id = $1"
      : "UPDATE accounts SET plan = 'FREE', subscription_status = NULL, current_period_end = NULL WHERE id = $1",
    [id],
  );
  await audit({
    action: "admin.user_plan_changed",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: id,
    detail: { from: before.plan, to },
    headers,
  });
  return userDetail(id);
}

/** Ends every session of an account without suspending it (a lost laptop, a doubt). Returns how many ended. */
export async function revokeUserSessions(
  actor: { id: string; email: string },
  id: string,
  headers?: Headers,
): Promise<{ revoked: number; user: UserDetail }> {
  await userDetail(id);
  const rows = await query("DELETE FROM sessions WHERE account_id = $1 RETURNING id", [id]);
  await audit({
    action: "admin.sessions_revoked",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: id,
    detail: { count: rows.length },
    headers,
  });
  return { revoked: rows.length, user: await userDetail(id) };
}

/**
 * Law 25 portability: everything Verikora holds about an account, as one JSON document — the account (never its password
 * hash), its documents' metadata (never the files or their text: each is downloadable from the library), its analyses with
 * the reports Sovkora returned, its open sessions' addresses and the audit trail that names it.
 */
export async function exportAccount(
  actor: { id: string; email: string },
  id: string,
  headers?: Headers,
): Promise<Record<string, unknown>> {
  const user = await userDetail(id);
  const documents = await query<{
    id: string;
    title: string;
    filename: string;
    mime_type: string;
    kind: string;
    size_bytes: number;
    sha256: string;
    pages: number | null;
    sample: boolean;
    created_at: Date;
  }>(
    "SELECT id, title, filename, mime_type, kind, size_bytes, sha256, pages, sample, created_at FROM documents WHERE owner_id = $1 ORDER BY created_at",
    [id],
  );
  const analyses = await query<{
    id: string;
    document_id: string;
    studio: string;
    status: string;
    run_id: string | null;
    blueprint_version: string | null;
    report: unknown;
    error: string | null;
    created_at: Date;
    finished_at: Date | null;
  }>(
    "SELECT x.id, x.document_id, x.studio, x.status, x.run_id, x.blueprint_version, x.report, x.error, x.created_at, x.finished_at FROM analyses x JOIN documents d ON d.id = x.document_id WHERE d.owner_id = $1 ORDER BY x.created_at",
    [id],
  );
  const sessions = await query<{ created_at: Date; expires_at: Date; ip: string | null; user_agent: string | null }>(
    "SELECT created_at, expires_at, ip, user_agent FROM sessions WHERE account_id = $1 ORDER BY created_at",
    [id],
  );
  const trail = await auditLog(1000, id);
  await audit({
    action: "admin.account_exported",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: id,
    detail: { documents: documents.length, analyses: analyses.length },
    headers,
  });
  return {
    format: "verikora-account-export/1",
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    },
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      filename: d.filename,
      mimeType: d.mime_type,
      kind: d.kind,
      sizeBytes: d.size_bytes,
      sha256: d.sha256,
      pages: d.pages,
      sample: d.sample,
      createdAt: d.created_at.toISOString(),
    })),
    analyses: analyses.map((x) => ({
      id: x.id,
      documentId: x.document_id,
      studio: x.studio,
      status: x.status,
      runId: x.run_id,
      blueprintVersion: x.blueprint_version,
      report: x.report,
      error: x.error,
      createdAt: x.created_at.toISOString(),
      finishedAt: x.finished_at?.toISOString() ?? null,
    })),
    sessions: sessions.map((s) => ({
      createdAt: s.created_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
      ip: s.ip,
      userAgent: s.user_agent,
    })),
    audit: trail,
  };
}

/**
 * Law 25 erasure: the account, its sessions, its documents (files and text) and their analyses are deleted. The audit
 * trail keeps the *fact* (who deleted, when, which id, how many documents) but not the person: the deleted account's own
 * rows lose their e-mail and address. The administrator confirms by typing the account's e-mail; never their own account,
 * never the last administrator.
 */
export async function deleteAccount(
  actor: { id: string; email: string },
  id: string,
  confirmEmail: string,
  headers?: Headers,
): Promise<{ deleted: true; documents: number }> {
  const user = await userDetail(id);
  if (id === actor.id) throw refuse(409, "SELF_DELETE", "You cannot delete your own account");
  if (user.role === "ADMIN") {
    const [{ n }] = await query<{ n: string }>(
      "SELECT count(*) AS n FROM accounts WHERE role = 'ADMIN' AND status = 'ACTIVE'",
    );
    if (Number(n) <= 1) throw refuse(409, "LAST_ADMIN", "The last administrator keeps the role");
  }
  if (confirmEmail.trim().toLowerCase() !== user.email)
    throw refuse(409, "CONFIRM_MISMATCH", "The e-mail typed does not match the account");
  // First the person goes out of the trail (the entries' actor column is cleared by the account's deletion, so it is read before it).
  await query("UPDATE audit.entry SET actor_label = 'deleted account', ip = NULL WHERE actor_id = $1", [id]);
  await query("DELETE FROM accounts WHERE id = $1", [id]);
  await audit({
    action: "admin.account_deleted",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: id,
    detail: { documents: user.documents },
    headers,
  });
  return { deleted: true, documents: user.documents };
}
