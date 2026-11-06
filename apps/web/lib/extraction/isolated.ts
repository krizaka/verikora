import { Worker } from "node:worker_threads";

import type { TextRun } from "@yomizaka/core";

import { findPackageDir } from "./package-dir";

/**
 * The PDF's text layer, read OFF the web process (yomizaka#21). pdf.js is CPU-bound: read in the request it would hold the
 * event loop for seconds (health checks and page loads stall, App Platform answers 504), and a hostile file could exhaust the
 * heap and kill the whole container. Here it runs in a `node:worker_threads` worker with its own heap limit, a deadline and a
 * page ceiling: whatever goes wrong ends the worker, and the web process keeps serving.
 */
export type ExtractionFailure = "TIMEOUT" | "MEMORY" | "TOO_MANY_PAGES" | "FAILED";

export class ExtractionError extends Error {
  constructor(readonly code: ExtractionFailure) {
    super(`PDF extraction failed: ${code}`);
    this.name = "ExtractionError";
  }
}

export interface ExtractionLimits {
  /** The deadline of one file; the worker is ended when it passes. */
  timeoutMs: number;
  /** The worker's own old-generation heap, in MB: a decompression bomb ends the worker, not the process. */
  maxHeapMb: number;
  /** Pages read at most; a longer document is refused, not truncated. */
  maxPages: number;
}

/** 10 s, 384 MB, 150 pages — what the issue's guardrails say, inside the 512 MB container. */
export const DEFAULT_LIMITS: ExtractionLimits = { timeoutMs: 10_000, maxHeapMb: 384, maxPages: 150 };

type Answer =
  | { id: number; ok: true; pages: number; text: string; runs?: TextRun[] }
  | { id: number; ok: false; code: "TOO_MANY_PAGES" | "FAILED" };

/**
 * The worker's program (CommonJS, run from a string: nothing to trace into the standalone image but `unpdf` itself, which is external).
 * It stays up between files — loading pdf.js costs more than reading a page — and answers one job at a time, each document destroyed
 * once read.
 */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { extractText, getDocumentProxy } = require(workerData.unpdf);
const round = (n) => Math.round(n * 100) / 100;
// The face, size and box of each text run of a page (document forensics, krizaka-internal#6): the face's real name comes from the
// font object pdf.js loads while it reads the page's operators. Read here, in the isolated worker, never in the web process.
async function readRuns(pdf) {
  const runs = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const p = await pdf.getPage(page);
    const content = await p.getTextContent();
    await p.getOperatorList();
    for (const item of content.items) {
      if (!("str" in item) || !("transform" in item) || item.str.trim() === "") continue;
      const font = p.commonObjs.get(item.fontName);
      runs.push({
        page,
        text: item.str,
        font: (font && font.name) || item.fontName,
        size: round(Math.hypot(item.transform[2] || 0, item.transform[3] || 0)),
        x: item.transform[4] || 0,
        y: item.transform[5] || 0,
        width: item.width,
        height: item.height,
      });
    }
  }
  return runs;
}
parentPort.on("message", async ({ id, bytes, maxPages, withRuns }) => {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > maxPages) return parentPort.postMessage({ id, ok: false, code: "TOO_MANY_PAGES" });
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const answer = { id, ok: true, pages: totalPages, text: Array.isArray(text) ? text.join("\n") : text };
    parentPort.postMessage(withRuns ? { ...answer, runs: await readRuns(pdf) } : answer);
  } catch {
    parentPort.postMessage({ id, ok: false, code: "FAILED" });
  } finally {
    await pdf?.destroy?.().catch(() => undefined);
  }
});
`;

/** A worker is renewed after this many files (memory a document leaves behind never piles up) and ended after this much idle time. */
const WARM = { jobs: 50, idleMs: 30_000 };

interface Warm {
  worker: Worker;
  heapMb: number;
  jobs: number;
  idle?: NodeJS.Timeout;
}
let warm: Warm | null = null;
let started = 0;
/** Files are read one at a time: a queue, so one worker (and one heap) serves the process. */
let queue: Promise<unknown> = Promise.resolve();

/** How many workers this process has started: a batch of files shares one (tests and the logs read it). */
export const extractionWorkersStarted = (): number => started;

function endWorker(w: Warm | null) {
  if (!w) {
    return;
  }
  clearTimeout(w.idle);
  void w.worker.terminate();
  if (warm === w) {
    warm = null;
  }
}

function workerFor(maxHeapMb: number, unpdf: string): Warm {
  if (warm && warm.heapMb === maxHeapMb && warm.jobs < WARM.jobs) {
    return warm;
  }
  endWorker(warm);
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { unpdf },
    resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
  });
  // A worker never keeps the process alive: when the work is done the process may end.
  worker.unref();
  started++;
  warm = { worker, heapMb: maxHeapMb, jobs: 0 };
  return warm;
}

let nextId = 0;

function runJob(
  bytes: Uint8Array,
  { timeoutMs, maxHeapMb, maxPages }: ExtractionLimits,
  unpdf: string,
  withRuns: boolean,
): Promise<PdfRead> {
  return new Promise((resolve, reject) => {
    const w = workerFor(maxHeapMb, unpdf);
    clearTimeout(w.idle);
    w.jobs++;
    const id = ++nextId;
    let settled = false;
    const settle = (finish: () => void, keep: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      w.worker.off("message", onMessage);
      w.worker.off("error", onError);
      w.worker.off("exit", onExit);
      // A worker that answered stays warm; one that failed, timed out or died is ended — the next file starts a fresh one.
      if (keep && warm === w) {
        w.idle = setTimeout(() => endWorker(w), WARM.idleMs);
        w.idle.unref();
      } else {
        endWorker(w);
      }
      finish();
    };
    const onMessage = (answer: Answer) => {
      if (answer.id !== id) {
        return;
      }
      settle(
        () =>
          answer.ok
            ? resolve({ text: answer.text, pages: answer.pages, runs: answer.runs ?? [] })
            : reject(new ExtractionError(answer.code)),
        answer.ok || answer.code === "TOO_MANY_PAGES",
      );
    };
    const onError = (error: NodeJS.ErrnoException) =>
      settle(() => reject(new ExtractionError(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "MEMORY" : "FAILED")), false);
    const onExit = () => settle(() => reject(new ExtractionError("FAILED")), false);
    const deadline = setTimeout(() => settle(() => reject(new ExtractionError("TIMEOUT")), false), timeoutMs);
    w.worker.on("message", onMessage);
    w.worker.once("error", onError);
    w.worker.once("exit", onExit);
    const copy = new Uint8Array(bytes).buffer; // the worker gets its own copy; the caller keeps its bytes
    w.worker.postMessage({ id, bytes: copy, maxPages, withRuns }, [copy]);
  });
}

export interface PdfRead {
  text: string;
  pages: number;
  /** The text runs with their face, size and box; empty unless asked for. */
  runs: TextRun[];
}

function readInWorker(bytes: Uint8Array, limits: Partial<ExtractionLimits>, withRuns: boolean): Promise<PdfRead> {
  const job = queue.then(async () =>
    runJob(bytes, { ...DEFAULT_LIMITS, ...limits }, await findPackageDir("unpdf"), withRuns),
  );
  queue = job.catch(() => undefined);
  return job;
}

/** Reads a PDF's text layer (as pdf.js gives it: normalising is the caller's) in an isolated worker. Rejects with an `ExtractionError`, never with a crash of this process. */
export async function extractPdfText(
  bytes: Uint8Array,
  limits: Partial<ExtractionLimits> = {},
): Promise<{ text: string; pages: number }> {
  const { text, pages } = await readInWorker(bytes, limits, false);
  return { text, pages };
}

/** The text runs of a PDF (face, size, box), read by the same isolated worker and under the same limits. */
export async function extractPdfRuns(bytes: Uint8Array, limits: Partial<ExtractionLimits> = {}): Promise<TextRun[]> {
  return (await readInWorker(bytes, limits, true)).runs;
}
