/**
 * Why a batch waits instead of failing its rows one by one (verikora#248). Two kinds, both transient:
 *  - the account cannot pay for the next row (`PAYWALL`, `DAILY_LIMIT`, `FAIR_USE`): it waits for the account;
 *  - the engine cannot take it now (`SOVKORA_BUSY`: Sovkora allows a few concurrent runs per service account and says when to
 *    come back; `SOVKORA_UNAVAILABLE`: it did not answer): it waits for the engine, and the batch keeps going by itself.
 * Pure: the batch's runner and its page read the same list.
 */
export const PAUSE_FOR_ACCOUNT = ["PAYWALL", "DAILY_LIMIT", "FAIR_USE"] as const;
export const PAUSE_FOR_ENGINE = ["SOVKORA_BUSY", "SOVKORA_UNAVAILABLE"] as const;

const ACCOUNT = new Set<string>(PAUSE_FOR_ACCOUNT);
const ENGINE = new Set<string>(PAUSE_FOR_ENGINE);

/** The refusals that would refuse every next row too: the rest of the batch waits. */
export const pausesBatch = (code: string): boolean => ACCOUNT.has(code) || ENGINE.has(code);
/** Waiting for the account to pay (the page offers billing and stops polling). */
export const waitsForAccount = (code: string | null): boolean => !!code && ACCOUNT.has(code);
/** Waiting for the engine (the page keeps polling: the batch resumes by itself). */
export const waitsForEngine = (code: string | null): boolean => !!code && ENGINE.has(code);
