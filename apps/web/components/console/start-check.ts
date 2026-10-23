import { krizakaFetch } from "@krizaka/query";
import { type DocumentKind, documentView, type Jurisdiction } from "@yomizaka/core";
import { z } from "zod";

import { afterUpload } from "@/lib/check-flow";

import { refusalCode } from "./upload";

/** What happened after a drop: the check started, the report tab must ask (nothing sure), or the engine refused it (a code the tab shows). */
export interface StartOutcome {
  started: boolean;
  refused: string | null;
}

/**
 * Once a file landed: reads what Yomizaka understood of it, starts the check when the kind is sure (`afterUpload`), and keeps
 * the refusal's code for the report tab instead of dropping it. One path for the task page and the library's drop-anywhere.
 */
export async function startIfSure(id: string, requested: DocumentKind | "auto", jurisdictions: readonly Jurisdiction[], fetcher: typeof krizakaFetch = krizakaFetch): Promise<StartOutcome> {
  let start = null;
  try {
    const { document } = await fetcher(`/api/documents/${id}`, { schema: z.object({ document: documentView }) });
    start = afterUpload({ requested, insight: document.insight?.understanding ?? null, jurisdictions }).start;
  } catch {
    // Nothing sure: the report tab asks for the kind itself.
  }
  if (!start) return { started: false, refused: null };
  try {
    await fetcher(`/api/documents/${id}`, { method: "POST", json: start });
    return { started: true, refused: null };
  } catch (error) {
    return { started: false, refused: refusalCode(error) };
  }
}
