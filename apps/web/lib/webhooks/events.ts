import type { BatchView } from "../batch/run";

/**
 * What Verikora tells a customer's system (verikora#241): a batch has finished, a check has finished. The payload carries ids,
 * states, the customer's own references and reasons — never a document, a quoted passage or a report: the receiver reads those
 * with the API and its key (`GET /api/v1/checks/{id}`). Pure.
 */
export const WEBHOOK_EVENT = { batchFinished: "batch.finished", checkFinished: "check.finished" } as const;
export const WEBHOOK_EVENTS = Object.values(WEBHOOK_EVENT);

export interface WebhookEvent {
  id: string;
  type: (typeof WEBHOOK_EVENTS)[number];
  payload: Record<string, unknown>;
}

/** The events a finished batch gives: always `batch.finished`; a batch of one row (a check, from the API) also `check.finished`. The ids are stable, so emitting twice queues once. */
export function eventsOfFinishedBatch(batch: BatchView): WebhookEvent[] {
  const rows = batch.items.map((i) => ({
    line: i.line,
    file: i.file,
    reference: i.reference,
    state: i.state,
    error: i.error,
  }));
  const events: WebhookEvent[] = [
    {
      id: `batch:${batch.id}`,
      type: WEBHOOK_EVENT.batchFinished,
      payload: {
        id: batch.id,
        name: batch.name,
        createdAt: batch.createdAt,
        finishedAt: batch.finishedAt,
        counts: batch.counts,
        rows,
      },
    },
  ];
  const [only] = batch.items;
  if (batch.items.length === 1 && only)
    events.push({
      id: `check:${batch.id}`,
      type: WEBHOOK_EVENT.checkFinished,
      payload: {
        id: batch.id,
        state: only.state,
        reference: only.reference,
        error: only.error,
        finishedAt: batch.finishedAt,
      },
    });
  return events;
}
