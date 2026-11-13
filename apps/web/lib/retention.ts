import { STORAGE_KIND, type StorageKind } from "@verikora/core";
import { addHours } from "date-fns";
import type { QueryResultRow } from "pg";

import { audit } from "./audit";
import {
  DELETION_RULE,
  type DeletionRule,
  HELD_COLUMNS,
  type HeldRow,
  recordDeletionReceipt,
} from "./deletion-receipt";
import { noHolder, type ObjectHolder, removeObject } from "./document-objects";
import type { StoreDescriptor } from "./storage/port";

/**
 * Keep or purge (ADR-0007). By default a document is NOT kept: once its check has run, its file and its text are purged and
 * only the report stays. The person chooses « conserver » to keep it — on the configured store (Bunny in development, S3), or
 * in Krizaka's database when none is configured. A document that is never checked is purged after a window (configuration).
 */
export type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

/** The stores that hold a document's file outside the database. */
export const EXTERNAL = new Set<StorageKind>([STORAGE_KIND.bunny, STORAGE_KIND.s3, STORAGE_KIND.cloud]);

/** Where a new document goes, from the person's choice and the store configured now. */
export function storageFor(keep: boolean, active: StoreDescriptor): StorageKind {
  if (!keep) {
    return STORAGE_KIND.none;
  }
  return EXTERNAL.has(active.kind) ? active.kind : STORAGE_KIND.database;
}

const EXTENSION: Record<string, string> = { "application/pdf": "pdf", "text/plain": "txt" };

/** The object key of a kept document on an external store. */
export const objectKey = (owner: string, document: string, mimeType: string) =>
  `${owner}/${document}/original.${EXTENSION[mimeType] ?? "bin"}`.toLowerCase();

/** When a not-kept document that was never checked is purged. */
export const purgeDeadline = (now: Date, hours: number): Date => addHours(now, hours);

/** The SQL that says a row still holds bytes: in the store (`object_key`, ADR-0012) or in the legacy column. */
export const HOLDS_BYTES = "(object_key IS NOT NULL OR octet_length(content) > 0)";

/**
 * Purges the not-kept documents the condition selects: the stored file is deleted FIRST (ADR-0012), then the row loses its key, its
 * file and its text; one audit row per document. A file whose store does not answer (or that no store was given for) keeps its row and
 * its deadline: the next sweep retries it. Returns the ids purged.
 */
async function purgeWhere(
  q: Query,
  condition: string,
  values: unknown[],
  holder: ObjectHolder,
  record: (id: string) => Promise<void>,
  receipt: { rule: DeletionRule; now?: Date },
  scope = "storage = 'none'",
): Promise<string[]> {
  const candidates = await q<HeldRow & { storage_owner: string }>(
    `SELECT ${HELD_COLUMNS}, storage_owner FROM documents WHERE ${scope} AND ${condition} AND (${HOLDS_BYTES} OR text <> '')`,
    values,
  );
  const ready: string[] = [];
  const held = new Map<string, HeldRow>();
  for (const c of candidates) {
    if (c.object_key && !(await removeObject(c, holder))) {
      continue;
    }
    ready.push(c.id);
    held.set(c.id, c);
  }
  if (ready.length === 0) {
    return [];
  }
  const rows = await q<{ id: string }>(
    `UPDATE documents SET content = ''::bytea, text = '', object_key = NULL, retain_until = NULL, storage = 'none' WHERE id = ANY($1::uuid[]) AND ${scope} RETURNING id`,
    [ready],
  );
  // The purge is verifiable: one audit row per document (the file and its text go; the hash, the report and the signed certificate stay).
  for (const r of rows) {
    await record(String(r.id));
    // The receipt comes last: the store confirmed the object gone (above) and the row is emptied.
    await recordDeletionReceipt(q, held.get(String(r.id))!, receipt.rule, receipt.now);
  }
  return rows.map((r) => String(r.id));
}

/** Purges one not-kept document: its file and its text go, its title, hash and reports stay. True when something was purged. */
export async function purgeDocument(
  q: Query,
  documentId: string,
  reason = "after-check",
  holder: ObjectHolder = noHolder,
  now?: Date,
): Promise<boolean> {
  const purged = await purgeWhere(
    q,
    "id = $1",
    [documentId],
    holder,
    (id) =>
      audit({ action: "document.purged", actorId: null, actorLabel: "retention", targetId: id, detail: { reason } }),
    { rule: DELETION_RULE.afterCheck, now },
  );
  return purged.length > 0;
}

/**
 * After a check: purges the document when it is not kept, no other check of it is still running and no batch row is still
 * waiting to check it (verikora#250: one lease listed for compliance and for authenticity is one document).
 */
export async function purgeIfDone(q: Query, documentId: string, holder: ObjectHolder = noHolder): Promise<boolean> {
  const running = await q(
    "SELECT 1 FROM analyses WHERE document_id = $1 AND status = 'running' UNION ALL SELECT 1 FROM batch_items WHERE document_id = $1 AND state = 'pending' LIMIT 1",
    [documentId],
  );
  return running.length === 0 && (await purgeDocument(q, documentId, "after-check", holder));
}

/** The one-year class (Law 25, s. 11): documents kept past the decision whose year has passed (the manager's choice at the close). */
const DECISION_YEAR = "retention_policy = 'one-year-after-decision'";

/** The sweep: not-kept documents past their deadline (never checked), and documents kept a year past the decision whose year is up. Returns how many were purged. */
export async function purgeExpired(q: Query, now: Date, holder: ObjectHolder = noHolder): Promise<number> {
  const purged = await purgeWhere(
    q,
    "retain_until IS NOT NULL AND retain_until <= $1",
    [now],
    holder,
    (id) =>
      audit({
        action: "document.purged",
        actorId: null,
        actorLabel: "retention",
        targetId: id,
        detail: { reason: "window" },
      }),
    { rule: DELETION_RULE.window, now },
  );
  const afterDecision = await purgeWhere(
    q,
    "retain_until IS NOT NULL AND retain_until <= $1",
    [now],
    holder,
    (id) =>
      audit({
        action: "document.purged",
        actorId: null,
        actorLabel: "retention",
        targetId: id,
        detail: { reason: "one-year-after-decision" },
      }),
    { rule: DELETION_RULE.oneYearAfterDecision, now },
    DECISION_YEAR,
  );
  return purged.length + afterDecision.length;
}
