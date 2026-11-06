import type { Analysis } from "@verikora/core";

import { BATCH_ITEM, type BatchItemState, type BatchView } from "../batch/run";

/** The states in which a row has a report to read. */
export const hasReport = (state: BatchItemState) => state === BATCH_ITEM.done || state === BATCH_ITEM.reused;

/** A check as the API answers it (verikora#202): the one row of its batch, with where it stands and what it became. */
export interface CheckView {
  id: string;
  state: BatchItemState;
  file: string;
  reference: string | null;
  /** Why it did not run (`UNKNOWN_CHECK`, `PAYWALL`…), stable codes the docs list. */
  error: string | null;
  /** The stored document and its analysis, once there is one: the report is read from them. */
  documentId: string | null;
  analysisId: string | null;
  /** The report as Sovkora returned it, once the check is done (read by `GET`, never by the `POST`); `null` before, and when none was kept. */
  report: Analysis["report"];
  createdAt: string;
  finishedAt: string | null;
}

/** The check a batch of one carries; its id is the batch's, so `GET /api/v1/checks/{id}` reads it back. */
export function checkView(batch: BatchView, report: Analysis["report"] = null): CheckView {
  const [item] = batch.items;
  if (!item) throw new Error(`batch ${batch.id} has no row`);
  return {
    id: batch.id,
    state: item.state,
    file: item.file,
    reference: item.reference,
    error: item.error ?? (item.state === BATCH_ITEM.pending ? batch.pausedBy : null),
    documentId: item.documentId,
    analysisId: item.analysisId,
    report: hasReport(item.state) ? report : null,
    createdAt: batch.createdAt,
    finishedAt: batch.finishedAt,
  };
}
