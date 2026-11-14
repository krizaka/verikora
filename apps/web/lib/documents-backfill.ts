import { createHash } from "node:crypto";

import { audit } from "./audit";
import type { ObjectHolder } from "./document-objects";
import { objectKey, type Query } from "./retention";

/** What one run did (ADR-0012, step 4). */
export interface BackfillResult {
  /** Rows whose bytes were still in `documents.content`. */
  candidates: number;
  /** Rows whose bytes are now in the store, read back and checked against `documents.sha256`. */
  copied: number;
  /** Rows left as they were: the store did not answer, or the bytes read back differ from the recorded SHA-256. */
  failed: string[];
  /** True when nothing was written. */
  dryRun: boolean;
}

export interface BackfillOptions {
  dryRun?: boolean;
  /** The installation's tenant id (`documentsTenant()`, read at the edge): the first segment of the key a row gets. */
  tenant: string;
  /** Rows per run (a bound for one sweep); the rest waits for the next one. */
  limit?: number;
}

interface LegacyRow {
  id: string;
  owner_id: string;
  mime_type: string;
  sha256: string;
  storage: string;
  storage_owner: string;
  content: Buffer;
}

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Copies one row's bytes to its store, reads them back, and only then empties the column. True when the row now lives in the store. */
async function moveRow(q: Query, row: LegacyRow, holder: ObjectHolder, tenant: string): Promise<boolean> {
  const key = objectKey(tenant, row.owner_id, row.id, row.mime_type);
  try {
    const store = await holder({
      owner_id: row.owner_id,
      storage: row.storage,
      storage_owner: row.storage_owner,
      object_key: key,
    });
    if (!store) {
      return false;
    }
    await store.put(key, row.content, { contentType: row.mime_type });
    const back = await store.get(key);
    if (!back || sha256Of(back.bytes) !== row.sha256) {
      await store.delete(key);
      return false;
    }
  } catch {
    return false;
  }
  // The row is only changed if it is still the one that was read (nobody purged or rewrote it meanwhile).
  const done = await q<{ id: string }>(
    "UPDATE documents SET object_key = $2, content = ''::bytea WHERE id = $1 AND object_key IS NULL AND sha256 = $3 AND octet_length(content) > 0 RETURNING id",
    [row.id, key, row.sha256],
  );
  return done.length === 1;
}

/** Moves one row; 1 when it moved, 0 when it failed (its id joins `failed`). */
async function moveCounted(
  q: Query,
  row: LegacyRow,
  holder: ObjectHolder,
  tenant: string,
  failed: string[],
): Promise<number> {
  if (await moveRow(q, row, holder, tenant)) {
    return 1;
  }
  failed.push(row.id);
  return 0;
}

/**
 * Moves the bytes still in `documents.content` to the store (ADR-0012): put under the row's key, read back, SHA-256 checked, then the
 * column emptied. Idempotent (a row already in the store is not a candidate), batched by `limit`, resumable (a failure leaves the row
 * untouched for the next run) and harmless with `dryRun`. One audit row per run that did something.
 */
export async function backfillDocuments(
  q: Query,
  holder: ObjectHolder,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const dryRun = options.dryRun === true;
  const rows = await q<LegacyRow>(
    "SELECT id, owner_id, mime_type, sha256, storage, storage_owner, content FROM documents WHERE object_key IS NULL AND octet_length(content) > 0 ORDER BY created_at LIMIT $1",
    [options.limit ?? 50],
  );
  const failed: string[] = [];
  let copied = 0;
  if (!dryRun) {
    for (const row of rows) {
      copied += await moveCounted(q, row, holder, options.tenant, failed);
    }
    if (rows.length > 0) {
      await audit({
        action: "documents.backfilled",
        actorId: null,
        actorLabel: "backfill",
        targetId: null,
        detail: { candidates: rows.length, copied, failed: failed.length },
      });
    }
  }
  return { candidates: rows.length, copied, failed, dryRun };
}
