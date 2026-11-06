import {
  ANALYSIS_STATUS,
  type Audience,
  BATCH_ITEM,
  type BatchItemState,
  type FlowEnvironment,
  readBatchManifest,
  type StartAnalysis,
} from "@verikora/core";

import { storesOf, workingStore } from "@/app/active-store";

import { getAnalysis } from "../analyses";
import { startCheck } from "../checks";
import { query, withNamedLock } from "../db";
import { storeDocument } from "../documents";
import { HttpError, refuse } from "../http";
import { placeDocument } from "../organisation/store";
import { isPhoto, storePhotos } from "../photos";
import { VERIKORA_RULES } from "../preflight/rules";
import { preflightRulesFrom, type Snapshot } from "../settings/boundary";
import { notifyFinished } from "./observer";
import { pausesBatch } from "./pausing";
import { type BatchFile, PREVIEW_ROW, previewBatch } from "./preview";

/**
 * A batch of checks (verikora#232, part 2): created from the CSV and its files — the refused rows recorded with their reason,
 * every other file stored as a document (not kept beyond the workspace's purge) and its row pending — then advanced: the
 * running rows read back from their analyses, the pending ones started through the single check path (`startCheck`: reuse,
 * entitlement, flow) up to the workspace's concurrency. A batch advances while it is looked at, like a single check (no
 * second scheduler); a row that fails never stops the others, and a missing entitlement pauses the rest with its reason.
 */
// The row states are the apps' contract too: @verikora/core holds them.
export { BATCH_ITEM, type BatchItemState } from "@verikora/core";

export interface BatchItemView {
  id: string;
  line: number;
  file: string;
  reference: string | null;
  state: BatchItemState;
  error: string | null;
  documentId: string | null;
  analysisId: string | null;
}

export interface BatchView {
  id: string;
  name: string;
  createdAt: string;
  finishedAt: string | null;
  items: BatchItemView[];
  counts: Record<BatchItemState, number>;
  /** Why the pending rows wait (`PAYWALL`…), until the account can pay for them. */
  pausedBy: string | null;
}

type Account = { id: string; perspective: Audience | null };
/** Where the checks run (the flows are offered per environment): read by the route, given here — domain code reads no env. */
type Context = { settings: Snapshot; now: Date; environment: FlowEnvironment };
// @fixed: the code `startAnalysis` answers when the same check of the same document is already running — a technical identifier
const ALREADY_RUNNING = "ALREADY_RUNNING";
const codeOf = (error: unknown) =>
  error instanceof HttpError ? String((error.body as { code?: string })?.code ?? "FAILED") : "FAILED";

export async function createBatch(
  account: Account,
  name: string,
  manifestText: string,
  files: readonly BatchFile[],
  { settings, now, environment }: Context,
): Promise<BatchView> {
  const preview = await previewBatch(account.id, manifestText, files, settings, now);
  if (!preview.rows.length) throw refuse(422, "BATCH_EMPTY", "The CSV has no row to check");
  const [batch] = await query<{ id: string }>("INSERT INTO batches (owner_id, name) VALUES ($1, $2) RETURNING id", [
    account.id,
    name.trim().slice(0, 200) || "Lot",
  ]);
  const stores = await storesOf(account.id);
  const policy = {
    keep: false,
    store: stores.write,
    working: await workingStore(),
    now,
    purgeAfterHours: settings["limits.purgeAfterHours"].value as number,
    rules: preflightRulesFrom(VERIKORA_RULES, settings),
  };
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const manifestRows = new Map(readBatchManifest(manifestText).rows.map((r) => [r.line, r]));
  for (const row of preview.rows) {
    const source = manifestRows.get(row.line);
    if (row.state === PREVIEW_ROW.refused || !source?.request) {
      await insertItem({
        batchId: batch!.id,
        line: row.line,
        file: row.file,
        reference: row.reference,
        request: null,
        documentId: null,
        state: BATCH_ITEM.refused,
        error: row.errors.join(",") || "REFUSED",
      });
      continue;
    }
    const file = byName.get(row.file.toLowerCase())!;
    // One file that cannot be stored is that row's refusal, never the batch's: the others go on (verikora#249).
    try {
      const stored = isPhoto(file.bytes)
        ? await storePhotos(account.id, [file], source.documentType ?? "auto", { policy })
        : await storeDocument(
            account.id,
            { name: file.name, type: file.type, size: file.bytes.length },
            file.bytes,
            source.documentType ?? "auto",
            policy,
          );
      await placeInCollection(account.id, stored.summary.id, source.collection).catch(() => undefined);
      await insertItem({
        batchId: batch!.id,
        line: row.line,
        file: row.file,
        reference: row.reference,
        request: source.request,
        documentId: stored.summary.id,
        state: BATCH_ITEM.pending,
        error: null,
      });
    } catch (error) {
      await insertItem({
        batchId: batch!.id,
        line: row.line,
        file: row.file,
        reference: row.reference,
        request: null,
        documentId: null,
        state: BATCH_ITEM.refused,
        error: codeOf(error),
      });
    }
  }
  return advanceBatch(account, batch!.id, { settings, now, environment });
}

/** A row naming the building's collection files its document there (verikora#251); a name that is not one of the owner's collections leaves it where it is. */
async function placeInCollection(ownerId: string, documentId: string, name: string | null) {
  if (!name) return;
  const [found] = await query<{ id: string }>(
    "SELECT c.id FROM collections c JOIN libraries l ON l.id = c.library_id WHERE l.owner_id = $1 AND lower(c.name) = lower($2) ORDER BY c.created_at LIMIT 1",
    [ownerId, name],
  );
  if (found) await placeDocument(query, ownerId, documentId, { collectionId: found.id, folderId: null });
}

interface NewItem {
  batchId: string;
  line: number;
  file: string;
  reference: string | null;
  request: StartAnalysis | null;
  documentId: string | null;
  state: BatchItemState;
  error: string | null;
}

async function insertItem(item: NewItem) {
  await query(
    "INSERT INTO batch_items (batch_id, line, file_name, reference, request, document_id, state, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      item.batchId,
      item.line,
      item.file,
      item.reference,
      item.request ? JSON.stringify(item.request) : null,
      item.documentId,
      item.state,
      item.error,
    ],
  );
}

/** Reads the running rows back, starts pending ones up to the concurrency, closes the batch when nothing is left. */
export async function advanceBatch(account: Account, batchId: string, context: Context): Promise<BatchView> {
  await ownBatch(account.id, batchId);
  // One advance of a batch at a time (verikora#266): the server tick and someone reading it would both start the same pending row.
  // The caller that finds it taken gets the batch as it stands; the one working will have moved it.
  const advanced = await withNamedLock(`batch:${batchId.toLowerCase()}`, () => advanceOnce(account, batchId, context));
  return advanced ?? { ...(await batchView(account.id, batchId)), pausedBy: null };
}

async function advanceOnce(
  account: Account,
  batchId: string,
  { settings, now, environment }: Context,
): Promise<BatchView> {
  const items = await query<BatchItemRow>(
    "SELECT id, state, document_id, analysis_id, request FROM batch_items WHERE batch_id = $1 ORDER BY line",
    [batchId],
  );
  let running = await settleRunning(account.id, items);
  const concurrency = settings["limits.batchConcurrency"].value as number;
  let pausedBy: string | null = null;
  for (const item of items.filter((i) => i.state === BATCH_ITEM.pending)) {
    if (running >= concurrency) break;
    const outcome = await startItem(account, item, now, environment);
    running += outcome.running;
    pausedBy = outcome.pausedBy;
    if (pausedBy) break;
  }
  const [{ left }] = (await query<{ left: number }>(
    "SELECT count(*)::int AS left FROM batch_items WHERE batch_id = $1 AND state IN ('pending', 'running')",
    [batchId],
  )) as [{ left: number }];
  // The batch closes once; the one call that closes it tells the observer (the customer's webhooks, verikora#241).
  const closed =
    left === 0
      ? await query("UPDATE batches SET finished_at = $2 WHERE id = $1 AND finished_at IS NULL RETURNING id", [
          batchId,
          now,
        ])
      : [];
  const view = { ...(await batchView(account.id, batchId)), pausedBy };
  if (closed.length) await notifyFinished(account.id, view, now);
  return view;
}

type BatchItemRow = {
  id: string;
  state: BatchItemState;
  document_id: string | null;
  analysis_id: string | null;
  request: StartAnalysis | null;
};

/** Reads the running rows back from their analyses, closes the ones that ended; returns how many still run. */
async function settleRunning(ownerId: string, items: readonly BatchItemRow[]): Promise<number> {
  let running = 0;
  for (const item of items.filter((i) => i.state === BATCH_ITEM.running && i.document_id && i.analysis_id)) {
    const analysis = await getAnalysis(ownerId, item.document_id!, item.analysis_id!);
    if (analysis.status === ANALYSIS_STATUS.succeeded) await setState(item.id, BATCH_ITEM.done, null);
    else if (analysis.status === ANALYSIS_STATUS.failed || analysis.status === ANALYSIS_STATUS.cancelled)
      await setState(item.id, BATCH_ITEM.failed, analysis.status.toUpperCase());
    else running++;
  }
  return running;
}

/** Starts one pending row through the single check path: how many more run because of it, and the reason the batch pauses, if any. */
async function startItem(
  account: Account,
  item: BatchItemRow,
  now: Date,
  environment: FlowEnvironment,
): Promise<StartOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      const started = await startCheck(account, item.document_id!, item.request!, now, environment);
      await query("UPDATE batch_items SET analysis_id = $2, state = $3, error = NULL WHERE id = $1", [
        item.id,
        started.analysis.id,
        started.reused ? BATCH_ITEM.reused : BATCH_ITEM.running,
      ]);
      return { running: started.reused ? 0 : 1, pausedBy: null };
    } catch (error) {
      const outcome = await outcomeOfRefusal(account, item, codeOf(error), attempt);
      if (outcome) return outcome;
    }
  }
}

type StartOutcome = { running: number; pausedBy: string | null };

/** What a refused start means for its row; null when the start should be tried once more. */
async function outcomeOfRefusal(
  account: Account,
  item: BatchItemRow,
  code: string,
  attempt: number,
): Promise<StartOutcome | null> {
  // The same check of the same document is already running (a row of another batch, a page). Bring it up to date — it may have
  // finished in Sovkora while nobody looked — then the normal rules apply again (reuse its result or start); while it truly
  // runs, this row waits for it.
  if (code === ALREADY_RUNNING) {
    if (attempt < 2 && !(await refreshBlocking(account.id, item.document_id!, item.request!.studio))) return null;
    return { running: 1, pausedBy: null };
  }
  if (pausesBatch(code)) return { running: 0, pausedBy: code };
  await setState(item.id, BATCH_ITEM.failed, code);
  return { running: 0, pausedBy: null };
}

/** Brings up to date the analyses already running on a document for a Studio; true while one still runs. */
async function refreshBlocking(ownerId: string, documentId: string, studio: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM analyses WHERE document_id = $1 AND studio = $2 AND status = 'running'",
    [documentId, studio],
  );
  let stillRunning = false;
  for (const row of rows)
    if ((await getAnalysis(ownerId, documentId, row.id)).status === ANALYSIS_STATUS.running) stillRunning = true;
  return stillRunning;
}

async function setState(id: string, state: BatchItemState, error: string | null) {
  await query("UPDATE batch_items SET state = $2, error = $3 WHERE id = $1", [id, state, error]);
}

async function ownBatch(ownerId: string, batchId: string) {
  const [row] = await query<{ id: string }>("SELECT id FROM batches WHERE owner_id = $1 AND id = $2", [
    ownerId,
    batchId,
  ]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such batch");
}

/** The batch as its page shows it: its rows in the CSV's order, and how many are in each state. */
export async function batchView(ownerId: string, batchId: string): Promise<BatchView> {
  const [batch] = await query<{ id: string; name: string; created_at: Date; finished_at: Date | null }>(
    "SELECT id, name, created_at, finished_at FROM batches WHERE owner_id = $1 AND id = $2",
    [ownerId, batchId],
  );
  if (!batch) throw refuse(404, "NOT_FOUND", "No such batch");
  const rows = await query<{
    id: string;
    line: number;
    file_name: string;
    reference: string | null;
    state: BatchItemState;
    error: string | null;
    document_id: string | null;
    analysis_id: string | null;
  }>(
    "SELECT id, line, file_name, reference, state, error, document_id, analysis_id FROM batch_items WHERE batch_id = $1 ORDER BY line",
    [batchId],
  );
  const counts = Object.fromEntries(Object.values(BATCH_ITEM).map((s) => [s, 0])) as Record<BatchItemState, number>;
  for (const r of rows) counts[r.state]++;
  return {
    id: batch.id,
    name: batch.name,
    createdAt: batch.created_at.toISOString(),
    finishedAt: batch.finished_at?.toISOString() ?? null,
    items: rows.map((r) => ({
      id: r.id,
      line: r.line,
      file: r.file_name,
      reference: r.reference,
      state: r.state,
      error: r.error,
      documentId: r.document_id,
      analysisId: r.analysis_id,
    })),
    counts,
    pausedBy: null,
  };
}

/** The account's batches, newest first, with their counts (the batches page). */
export async function listBatches(
  ownerId: string,
): Promise<{ id: string; name: string; createdAt: string; finishedAt: string | null; items: number; done: number }[]> {
  const rows = await query<{
    id: string;
    name: string;
    created_at: Date;
    finished_at: Date | null;
    items: number;
    done: number;
  }>(
    `SELECT b.id, b.name, b.created_at, b.finished_at, count(i.id)::int AS items, count(i.id) FILTER (WHERE i.state IN ('done', 'reused'))::int AS done
       FROM batches b LEFT JOIN batch_items i ON i.batch_id = b.id WHERE b.owner_id = $1 GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`,
    [ownerId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
    items: r.items,
    done: r.done,
  }));
}
