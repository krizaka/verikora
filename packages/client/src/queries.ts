import { defineKeys, queryOptions } from "@krizaka/query";
import { ANALYSIS_STATUS } from "@verikora/core";

import type { Locale, VerikoraApi } from "./api";

/** One module for the server state: the keys and the queries, so a screen reads and an action invalidates the same names. */
export const keys = defineKeys("verikora", {
  limits: () => [],
  me: () => [],
  documents: () => [],
  document: (id: string) => [id],
  analysis: (documentId: string, analysisId: string, locale: Locale) => [documentId, analysisId, locale],
  libraries: () => [],
  collection: (id: string, tags: readonly string[]) => [id, ...tags],
  batches: () => [],
  batch: (id: string) => [id],
});

// @fixed: the engine answers in seconds; a screen that polls faster only burns the battery
export const ANALYSIS_POLL_MS = 2_500;
// @fixed: the limits change when an operator publishes a setting, not while a person is checking a lease
const LIMITS_STALE_MS = 5 * 60_000;

export function createQueries(api: VerikoraApi) {
  return {
    me: () => queryOptions({ queryKey: keys.me(), queryFn: api.fetchMe }),
    limits: () => queryOptions({ queryKey: keys.limits(), queryFn: api.fetchLimits, staleTime: LIMITS_STALE_MS }),
    documents: () => queryOptions({ queryKey: keys.documents(), queryFn: api.listDocuments }),
    document: (id: string) => queryOptions({ queryKey: keys.document(id), queryFn: () => api.fetchDocument(id) }),
    libraries: () => queryOptions({ queryKey: keys.libraries(), queryFn: api.fetchLibraries }),
    collection: (id: string, tags: readonly string[]) =>
      queryOptions({ queryKey: keys.collection(id, tags), queryFn: () => api.fetchCollection(id, tags) }),
    batches: () => queryOptions({ queryKey: keys.batches(), queryFn: api.listBatches }),
    /** A batch polls (each read advances it) until it is finished or waits for the account. */
    batch: (id: string) =>
      queryOptions({
        queryKey: keys.batch(id),
        queryFn: () => api.fetchBatch(id),
        refetchInterval: (query) =>
          !query.state.data || (!query.state.data.finishedAt && !query.state.data.pausedBy) ? ANALYSIS_POLL_MS : false,
      }),
    /** An analysis polls while it runs and stops when it is over. */
    analysis: (documentId: string, analysisId: string, locale: Locale) =>
      queryOptions({
        queryKey: keys.analysis(documentId, analysisId, locale),
        queryFn: () => api.fetchAnalysis(documentId, analysisId, locale),
        refetchInterval: (query) =>
          !query.state.data || query.state.data.analysis.status === ANALYSIS_STATUS.running ? ANALYSIS_POLL_MS : false,
      }),
  };
}
