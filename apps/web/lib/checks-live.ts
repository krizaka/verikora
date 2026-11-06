import type { DocumentStatus } from "@verikora/core";

/* Pure and client-safe (no database, no node modules): the Vérifications view reads it too. */

/** The checks still running: the page refreshes them from Sovkora before listing; the view asks again while one runs. */
export const runningChecks = <T extends { result: DocumentStatus }>(checks: readonly T[]): T[] =>
  checks.filter((c) => c.result === "analysing");
