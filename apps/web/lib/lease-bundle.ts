import type { ComplianceReport } from "@verikora/core";

import { query } from "./db";
import { isUuid } from "./documents";
import { refuse } from "./http";

/**
 * A lease and its annexes as one submission (verikora#129). The check runs on each document with the ruleset chosen by data
 * (jurisdiction + version, from the flow); this reads the reports back as one list, line by line, with the article each finding cites and
 * the ruleset's review status. It states what a ruleset reports: no advice, no verdict about the lease (« conforme », « approuvé »...).
 */
export const DOCUMENT_ROLE = { lease: "lease", annex: "annex", buildingRules: "building-rules" } as const;
export type DocumentRole = (typeof DOCUMENT_ROLE)[keyof typeof DOCUMENT_ROLE];
// @fixed: one lease with this many annexes is a bundle; more is a mistake (a folder, not a lease)
export const MAX_ANNEXES = 20;

export interface BundleDocument {
  id: string;
  title: string;
  role: DocumentRole;
  /** The latest compliance report of the document, null while none ended. */
  report: ComplianceReport | null;
}
export interface BundleLine {
  documentId: string;
  documentTitle: string;
  role: DocumentRole;
  line: number | null;
  quote: string | null;
  ruleId: string;
  article: string | null;
  severity: string;
  verdict: string;
}
export interface BundleRuleset {
  jurisdiction: string;
  rulesetId: string;
  rulesetVersion: string;
  /** `TO_REVIEW_BY_LAWYER` while a lawyer has not reviewed the ruleset: the report says so. */
  reviewStatus: string | null;
}
export interface LeaseBundle {
  leaseId: string;
  documents: { id: string; title: string; role: DocumentRole; checked: boolean }[];
  rulesets: BundleRuleset[];
  lines: BundleLine[];
}

/** Pure: the bundle's documents (the lease first, then in the order given) → one list of lines. */
export function bundleOf(leaseId: string, documents: readonly BundleDocument[]): LeaseBundle {
  const rulesets = new Map<string, BundleRuleset>();
  const lines: BundleLine[] = [];
  for (const d of documents) {
    if (!d.report) continue;
    rulesets.set(`${d.report.rulesetId}@${d.report.rulesetVersion}`, {
      jurisdiction: d.report.jurisdiction,
      rulesetId: d.report.rulesetId,
      rulesetVersion: d.report.rulesetVersion,
      reviewStatus: d.report.reviewStatus ?? null,
    });
    const own = d.report.findings.map((f) => ({
      documentId: d.id,
      documentTitle: d.title,
      role: d.role,
      line: f.line ?? null,
      quote: f.evidenceSpan?.quote ?? null,
      ruleId: f.ruleId,
      article: f.citation ?? null,
      severity: f.severity,
      verdict: f.verdict,
    }));
    lines.push(...own.sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER)));
  }
  return {
    leaseId,
    documents: documents.map((d) => ({ id: d.id, title: d.title, role: d.role, checked: d.report !== null })),
    rulesets: [...rulesets.values()],
    lines,
  };
}

const notFound = () => refuse(404, "NOT_FOUND", "No such document");

/** Puts a document in a lease's bundle as an annex or the building's rules. Both are the person's own; a lease is not an annex of itself. */
export async function attachToLease(
  ownerId: string,
  leaseId: string,
  documentId: string,
  role: DocumentRole,
): Promise<void> {
  if (!isUuid(leaseId) || !isUuid(documentId)) throw notFound();
  if (role === DOCUMENT_ROLE.lease || leaseId === documentId)
    throw refuse(400, "BAD_REQUEST", "A document is attached as an annex or as the building's rules");
  const rows = await query<{ id: string; document_role: string }>(
    "SELECT id, document_role FROM documents WHERE owner_id = $1 AND id = ANY($2)",
    [ownerId, [leaseId, documentId]],
  );
  const lease = rows.find((r) => r.id === leaseId);
  if (!lease || !rows.some((r) => r.id === documentId)) throw notFound();
  if (lease.document_role !== DOCUMENT_ROLE.lease)
    throw refuse(409, "NOT_A_LEASE", "Annexes are attached to a lease, not to another annex");
  const counted = await query<{ n: string }>("SELECT count(*) AS n FROM documents WHERE lease_id = $1 AND id <> $2", [
    leaseId,
    documentId,
  ]);
  if (Number(counted[0]?.n ?? 0) >= MAX_ANNEXES)
    throw refuse(409, "TOO_MANY_ANNEXES", `A lease takes at most ${MAX_ANNEXES} annexes`);
  const moved = await query(
    "UPDATE documents SET document_role = $3, lease_id = $2 WHERE owner_id = $1 AND id = $4 AND NOT EXISTS (SELECT 1 FROM documents c WHERE c.lease_id = $4) RETURNING id",
    [ownerId, leaseId, role, documentId],
  );
  if (moved.length === 0) throw refuse(409, "HAS_ANNEXES", "A document that has annexes of its own cannot become one");
}

/** Takes an annex out of its bundle: it is a document of its own again. */
export async function detachFromLease(ownerId: string, leaseId: string, documentId: string): Promise<void> {
  if (!isUuid(leaseId) || !isUuid(documentId)) throw notFound();
  const rows = await query(
    "UPDATE documents SET document_role = 'lease', lease_id = NULL WHERE owner_id = $1 AND lease_id = $2 AND id = $3 RETURNING id",
    [ownerId, leaseId, documentId],
  );
  if (rows.length === 0) throw notFound();
}

/** The bundle of one lease: the reports of the lease and its annexes, read as one. 404 for a document that is not the person's. */
export async function leaseBundle(ownerId: string, leaseId: string): Promise<LeaseBundle> {
  if (!isUuid(leaseId)) throw notFound();
  const rows = await query<{ id: string; title: string; document_role: DocumentRole; report: ComplianceReport | null }>(
    `SELECT d.id, d.title, d.document_role,
            (SELECT a.report FROM analyses a WHERE a.document_id = d.id AND a.studio = 'compliance-check' AND a.status = 'succeeded' ORDER BY a.created_at DESC LIMIT 1) AS report
       FROM documents d WHERE d.owner_id = $1 AND (d.id = $2 OR d.lease_id = $2)
      ORDER BY (d.id = $2) DESC, d.created_at, d.id`,
    [ownerId, leaseId],
  );
  if (!rows.some((r) => r.id === leaseId)) throw notFound();
  return bundleOf(
    leaseId,
    rows.map((r) => ({ id: r.id, title: r.title, role: r.document_role, report: r.report })),
  );
}
