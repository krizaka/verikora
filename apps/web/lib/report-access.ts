import { query } from "./db";
import { refuse } from "./http";

/**
 * Who may verify a signed report (ADR-0002). Verification is for a signed-in member of Verikora who is the owner of the
 * checked document, or to whom the owner granted access on that report. A grant names an e-mail, may carry an expiry, and
 * can be revoked; a revoked or expired grant opens nothing. Unknown report and no access answer the same 403, so the answer
 * tells a stranger nothing about what exists.
 */
export interface Grant {
  id: string;
  email: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** The report a signed file points to, as this server holds it: the analysis, its owner, the live and past grants. */
export interface Target {
  analysisId: string;
  documentId: string;
  ownerId: string;
  grants: Grant[];
}

export type Access =
  { allowed: true; via: "owner" } | { allowed: true; via: "grant"; grantId: string } | { allowed: false };

export const grantIsLive = (grant: Grant, now: Date) =>
  grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime());

/** Pure: the owner, or someone with a live grant on their e-mail. */
export function accessTo(target: Target, who: { id: string; email: string }, now: Date): Access {
  if (target.ownerId === who.id) return { allowed: true, via: "owner" };
  const email = who.email.trim().toLowerCase();
  const grant = target.grants.find((g) => g.email === email && grantIsLive(g, now));
  return grant ? { allowed: true, via: "grant", grantId: grant.id } : { allowed: false };
}

interface GrantRow {
  id: string;
  grantee_email: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}
const toGrant = (r: GrantRow): Grant => ({
  id: r.id,
  email: r.grantee_email,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

/** The analysis a report points to — by its Sovkora run id and the SHA-256 of its document — with its grants; null if this server holds none. */
export async function loadTarget(runId: string, documentSha256: string): Promise<Target | null> {
  const [row] = await query<{ analysis_id: string; document_id: string; owner_id: string }>(
    `SELECT a.id AS analysis_id, d.id AS document_id, d.owner_id
       FROM analyses a JOIN documents d ON d.id = a.document_id
      WHERE a.run_id = $1 AND d.sha256 = $2 AND a.studio = 'compliance-check' AND a.status = 'succeeded' LIMIT 1`,
    [runId, documentSha256],
  );
  if (!row) return null;
  const grants = await query<GrantRow>(
    "SELECT id, grantee_email, created_at, expires_at, revoked_at FROM report_grants WHERE analysis_id = $1",
    [row.analysis_id],
  );
  return {
    analysisId: row.analysis_id,
    documentId: row.document_id,
    ownerId: row.owner_id,
    grants: grants.map(toGrant),
  };
}

/** The pair a report file claims (run id, document hash), read without trusting it: only used to find the report's owner. */
export function referenceOf(file: string): { runId: string; documentSha256: string } | null {
  const match = /<script type="application\/json" id="verikora-attestation">([^<]*)<\/script>/.exec(
    file.includes("\r") ? file.replaceAll("\r\n", "\n") : file,
  );
  if (!match) return null;
  try {
    const payload = (
      JSON.parse(match[1]!) as { payload?: { check?: { runId?: unknown }; document?: { sha256?: unknown } } }
    ).payload;
    const runId = payload?.check?.runId;
    const documentSha256 = payload?.document?.sha256;
    return typeof runId === "string" && typeof documentSha256 === "string" && /^[0-9a-f]{64}$/.test(documentSha256)
      ? { runId, documentSha256 }
      : null;
  } catch {
    return null;
  }
}

/* ---- the owner's side: share, list, revoke, and the requests to answer ---- */

export type GrantStatus = "member" | "invited" | "expired" | "revoked";
export interface GrantView {
  id: string;
  email: string;
  status: GrantStatus;
  createdAt: string;
  expiresAt: string | null;
}
export interface AccessRequestView {
  id: string;
  email: string;
  createdAt: string;
}
export interface Sharing {
  grants: GrantView[];
  requests: AccessRequestView[];
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The owner's analysis, or a 404 (another account's report does not exist for you). */
async function ownedAnalysis(
  ownerId: string,
  documentId: string,
  analysisId: string,
): Promise<{ runId: string | null }> {
  if (!isUuid(documentId) || !isUuid(analysisId)) throw refuse(404, "NOT_FOUND", "No such analysis");
  const [row] = await query<{ run_id: string | null }>(
    "SELECT a.run_id FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 AND d.id = $2 AND a.id = $3",
    [ownerId, documentId, analysisId],
  );
  if (!row) throw refuse(404, "NOT_FOUND", "No such analysis");
  return { runId: row.run_id };
}

export async function listSharing(
  ownerId: string,
  documentId: string,
  analysisId: string,
  now: Date,
): Promise<Sharing> {
  await ownedAnalysis(ownerId, documentId, analysisId);
  const rows = await query<GrantRow & { member: boolean }>(
    `SELECT g.id, g.grantee_email, g.created_at, g.expires_at, g.revoked_at, EXISTS (SELECT 1 FROM accounts a WHERE a.email = g.grantee_email) AS member
       FROM report_grants g WHERE g.analysis_id = $1 ORDER BY g.created_at DESC`,
    [analysisId],
  );
  const requests = await query<{ id: string; requester_email: string; created_at: Date }>(
    "SELECT id, requester_email, created_at FROM report_access_requests WHERE analysis_id = $1 AND handled_at IS NULL ORDER BY created_at",
    [analysisId],
  );
  return {
    grants: rows.map((r) => {
      const grant = toGrant(r);
      const statusOf = (): GrantStatus => {
        if (grant.revokedAt) return "revoked";
        if (!grantIsLive(grant, now)) return "expired";
        return r.member ? "member" : "invited";
      };
      const status = statusOf();
      return {
        id: r.id,
        email: r.grantee_email,
        status,
        createdAt: r.created_at.toISOString(),
        expiresAt: r.expires_at?.toISOString() ?? null,
      };
    }),
    requests: requests.map((r) => ({ id: r.id, email: r.requester_email, createdAt: r.created_at.toISOString() })),
  };
}

/** Gives an e-mail access to the report. A member has it at once; an address with no account is an invitation. Returns the grant and whether the address is a member. */
export async function createGrant(
  owner: { id: string; email: string },
  documentId: string,
  analysisId: string,
  input: { email: string; expiresAt: Date | null },
  now: Date,
): Promise<{ grantId: string; member: boolean; runId: string | null }> {
  const { runId } = await ownedAnalysis(owner.id, documentId, analysisId);
  const email = input.email.trim().toLowerCase();
  if (email === owner.email.toLowerCase()) throw refuse(400, "OWN_ADDRESS", "You already own this report");
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime())
    throw refuse(400, "EXPIRY_IN_THE_PAST", "The expiry must be in the future");
  // A live grant for the same address is renewed, not duplicated.
  await query(
    "UPDATE report_grants SET revoked_at = now() WHERE analysis_id = $1 AND grantee_email = $2 AND revoked_at IS NULL",
    [analysisId, email],
  );
  const [row] = await query<{ id: string }>(
    "INSERT INTO report_grants (analysis_id, granted_by, grantee_email, expires_at) VALUES ($1, $2, $3, $4) RETURNING id",
    [analysisId, owner.id, email, input.expiresAt],
  );
  await query(
    "UPDATE report_access_requests SET handled_at = now() WHERE analysis_id = $1 AND lower(requester_email) = $2 AND handled_at IS NULL",
    [analysisId, email],
  );
  const [member] = await query<{ id: string }>("SELECT id FROM accounts WHERE email = $1", [email]);
  return { grantId: row!.id, member: !!member, runId };
}

export async function revokeGrant(
  ownerId: string,
  documentId: string,
  analysisId: string,
  grantId: string,
): Promise<{ email: string; runId: string | null }> {
  const { runId } = await ownedAnalysis(ownerId, documentId, analysisId);
  if (!isUuid(grantId)) throw refuse(404, "NOT_FOUND", "No such grant");
  const [row] = await query<{ grantee_email: string }>(
    "UPDATE report_grants SET revoked_at = now() WHERE id = $1 AND analysis_id = $2 AND revoked_at IS NULL RETURNING grantee_email",
    [grantId, analysisId],
  );
  if (!row) throw refuse(404, "NOT_FOUND", "No such grant");
  return { email: row.grantee_email, runId };
}

/** A member asks the owner for access. Idempotent, and a no-op for a report this server does not hold. */
export async function requestAccess(
  requester: { id: string; email: string },
  target: Target | null,
  now: Date,
): Promise<{ recorded: boolean }> {
  if (!target || accessTo(target, requester, now).allowed) return { recorded: false };
  const rows = await query(
    "INSERT INTO report_access_requests (analysis_id, requester_id, requester_email) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
    [target.analysisId, requester.id, requester.email.toLowerCase()],
  );
  return { recorded: rows.length > 0 };
}
