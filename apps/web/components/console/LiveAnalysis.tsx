"use client";

import { krizakaFetch, useQuery, useQueryClient } from "@krizaka/query";
import {
  type Analysis,
  analysis as analysisSchema,
  ANALYSIS_STATUS,
  type AnalysisStatus,
  queryKeys,
} from "@verikora/core";
import { useEffect } from "react";
import { z } from "zod";

// @fixed: the BFF asks Sovkora again at this pace while a run is running
const POLL_MS = 3000;

/** How often a run is asked again: every 3 s while it runs, never once it ended. */
export const pollInterval = (status: AnalysisStatus | undefined): number | false =>
  status === ANALYSIS_STATUS.running ? POLL_MS : false;

/**
 * A running analysis, asked again every 3 s (the BFF fetches and keeps Sovkora's result); once it ends, the document and the
 * lists are read again. Its own query, so the polling never re-renders the page around it (verikora#110).
 */
export function useLiveAnalysis(documentId: string, initial: Analysis): AnalysisStatus {
  const client = useQueryClient();
  const live = useQuery({
    queryKey: [...queryKeys.document(documentId), "analysis", initial.id],
    queryFn: () =>
      krizakaFetch(`/api/documents/${documentId}/analyses/${initial.id}`, {
        schema: z.object({ analysis: analysisSchema }),
      }).then((r) => r.analysis),
    initialData: initial,
    refetchInterval: (q) => pollInterval(q.state.data?.status),
  });
  const status = live.data?.status ?? initial.status;
  useEffect(() => {
    if (status !== ANALYSIS_STATUS.running)
      void Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.document(documentId) }),
        client.invalidateQueries({ queryKey: queryKeys.documents() }),
      ]);
  }, [status, client, documentId]);
  return status;
}

/** Follows one running analysis; draws nothing. */
export function LiveAnalysis({ documentId, analysis }: { documentId: string; analysis: Analysis }) {
  useLiveAnalysis(documentId, analysis);
  return null;
}
