import { logError } from "../log";
import type { BatchView } from "./run";

/**
 * Who is told when a batch closes (verikora#241). The runner does not know about webhooks: the server registers an observer at
 * start (instrumentation), a test registers its own. Shared through `globalThis` — pages and routes are bundled apart. A failing
 * observer is logged and never breaks the batch.
 */
export interface BatchObserver {
  finished(ownerId: string, batch: BatchView, now: Date): Promise<void>;
}

const holder = globalThis as unknown as { __verikoraBatchObserver?: BatchObserver };

export const setBatchObserver = (observer: BatchObserver | null) => {
  holder.__verikoraBatchObserver = observer ?? undefined;
};

export async function notifyFinished(ownerId: string, batch: BatchView, now: Date): Promise<void> {
  try {
    await holder.__verikoraBatchObserver?.finished(ownerId, batch, now);
  } catch (error) {
    logError(`[verikora] batch ${batch.id}: the finished observer failed`, error);
  }
}
