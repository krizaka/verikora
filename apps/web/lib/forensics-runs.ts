import type { TextRun } from "@verikora/core";

import { extractPdfRuns } from "./extraction/isolated";

/**
 * The port of slice 2 (krizaka-internal#6): « the text runs of a PDF, with their face, size and box ». The reading is pdf.js, run by
 * the isolated worker of `extraction/isolated.ts` (verikora#21), never in the web process: a heavy or hostile file ends the worker.
 */
export type TextRunReader = (bytes: Uint8Array) => Promise<TextRun[]>;

export const readTextRuns: TextRunReader = (bytes) => extractPdfRuns(bytes);
