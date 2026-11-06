import { z } from "zod";

/**
 * Reading a new document's text happens after the upload answered (verikora#21): `POST /api/documents` answers 202 Accepted
 * with the document `queued`, an isolated worker reads it, and the document becomes `done` (or `failed`, with the reason).
 * A document with no value here was read before this existed: it is `done`.
 */
export const EXTRACTION_STATUSES = ["queued", "running", "done", "failed"] as const;
export const extractionStatus = z.enum(EXTRACTION_STATUSES);
export type ExtractionStatus = z.infer<typeof extractionStatus>;

/** Whether the text is still being read (the document cannot be checked yet). */
export const isExtracting = (status: ExtractionStatus | undefined): boolean =>
  status === "queued" || status === "running";

export class ExtractionNotReady extends Error {
  constructor(
    readonly status: ExtractionStatus | "timeout",
    readonly reason: string | null = null,
  ) {
    super(`The document's text is not ready: ${status}`);
    this.name = "ExtractionNotReady";
  }
}

export interface WaitOptions {
  /** Time between two reads. */
  intervalMs?: number;
  /** After this the wait gives up (the worker has its own deadline; this is the client's). */
  deadlineMs?: number;
  /** The wait itself, injected (tests do not sleep). */
  sleep?: (ms: number) => Promise<void>;
  /** The clock, injected. */
  now?: () => number;
}

/**
 * Waits until a document's text is read: polls `read` until it is no longer queued or running. Resolves with the document
 * when `done`; rejects with `ExtractionNotReady` when it `failed` (with the reason) or the deadline passed.
 */
export async function waitForExtraction<T extends { extraction?: ExtractionStatus; extractionError?: string | null }>(
  read: () => Promise<T>,
  options: WaitOptions = {},
): Promise<T> {
  const {
    intervalMs = 700,
    deadlineMs = 90_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  const until = now() + deadlineMs;
  for (;;) {
    const document = await read();
    if (!isExtracting(document.extraction)) {
      if (document.extraction === "failed") throw new ExtractionNotReady("failed", document.extractionError ?? null);
      return document;
    }
    if (now() >= until) throw new ExtractionNotReady("timeout");
    await sleep(intervalMs);
  }
}
