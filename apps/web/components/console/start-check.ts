import { localDay } from "@krizaka/intl";
import { krizakaFetch } from "@krizaka/query";
import {
  type DocumentKind,
  documentView,
  ExtractionNotReady,
  type Jurisdiction,
  waitForExtraction,
} from "@verikora/core";
import { z } from "zod";

import { afterUpload } from "@/lib/check-flow";
import { LAW_TIME_ZONE } from "@/lib/rulesets";

import { refusalCode } from "./upload";

/** What happened after a drop: the check started, the report tab must ask (nothing sure), or the engine refused it (a code the tab shows). */
export interface StartOutcome {
  started: boolean;
  refused: string | null;
}

/**
 * Once a file landed: reads what Verikora understood of it, starts the check when the kind is sure (`afterUpload`), and keeps
 * the refusal's code for the report tab instead of dropping it. One path for the task page and the library's drop-anywhere.
 * `now` is the moment of the drop: the check is dated on its day in Québec (verikora#309).
 */
export async function startIfSure(
  id: string,
  requested: DocumentKind | "auto",
  jurisdictions: readonly Jurisdiction[],
  now: Date,
  fetcher: typeof krizakaFetch = krizakaFetch,
): Promise<StartOutcome> {
  let start = null;
  try {
    // The upload answered 202: the text is read after the answer (verikora#21), so wait for it before looking at what the document is.
    const document = await waitForExtraction(() =>
      fetcher(`/api/documents/${id}`, { schema: z.object({ document: documentView }) }).then((r) => r.document),
    );
    start = afterUpload({
      requested,
      insight: document.insight?.understanding ?? null,
      jurisdictions,
      asOf: localDay(now, LAW_TIME_ZONE),
    }).start;
  } catch (error) {
    // A text that could not be read says why; otherwise nothing is sure: the report tab asks for the kind itself.
    if (error instanceof ExtractionNotReady && error.reason) return { started: false, refused: error.reason };
  }
  if (!start) return { started: false, refused: null };
  try {
    await fetcher(`/api/documents/${id}`, { method: "POST", json: start });
    return { started: true, refused: null };
  } catch (error) {
    return { started: false, refused: refusalCode(error) };
  }
}
