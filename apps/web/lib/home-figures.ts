import { localDay } from "@krizaka/intl";

import { DISPLAY_TIME_ZONE } from "@/components/console/format";

import { LINK, type LinkState } from "./applicant-file-rules";
import { NO_CHECK_FILTERS, writeCheckFilters } from "./check-filters";
import { CONSOLE_ROUTES } from "./console-nav";
import { readFilterParams, writeFilterParams } from "./filter-params";

/*
 * The home's figures (verikora#325, P8 of the design direction § 5.1), pure: the browser reads them too. Each figure of
 * « À traiter » is a door to the saved view it counts, so its link carries that view's filter; the counts are queries
 * (lib/home.ts), never counters.
 */

export interface ToDo {
  /** Checks Sovkora flagged, or that did not end: Vérifications filtered on `attention,failed`. */
  toReview: number;
  /** Applicant files the candidate sent and nobody closed yet (link state `used`); null without the applicant-file flow. */
  toDecide: number | null;
  /** Links still open for a candidate (link state `open`); null without the flow. */
  openLinks: number | null;
  /** When the first open link expires (ISO), for « expire le … ». */
  nextExpiry?: string | null;
}

/** The results a check « to look at » has: the same words as the Vérifications filter it opens. */
export const TO_REVIEW_RESULTS = ["attention", "failed"] as const;

/** « Dossiers »'s filter in the address: `?state=open,used` (the link's state, a system fact). */
export const FILE_STATE_KEY = "state";
const FILE_STATES = Object.values(LINK);

export function readFileStates(search: string | URLSearchParams): LinkState[] {
  const read = readFilterParams(typeof search === "string" ? new URLSearchParams(search) : search, [FILE_STATE_KEY]);
  return FILE_STATES.filter((s) => (read[FILE_STATE_KEY] ?? []).includes(s));
}

/** The files a filter keeps: all of them without one. */
export const filesInStates = <F extends { status: LinkState }>(
  files: readonly F[],
  states: readonly LinkState[],
): F[] => (states.length ? files.filter((f) => states.includes(f.status)) : [...files]);

const filesHref = (locale: string, state: LinkState) =>
  `/${locale}${CONSOLE_ROUTES.files}?${writeFilterParams(new URLSearchParams(), { [FILE_STATE_KEY]: [state] }).toString()}`;

/** Where each figure of « À traiter » leads: its view, with that view's filter in the address. */
export function toDoLinks(locale: string): Record<"toReview" | "toDecide" | "openLinks", string> {
  return {
    toReview: `/${locale}${CONSOLE_ROUTES.checks}?${writeCheckFilters(new URLSearchParams(), { ...NO_CHECK_FILTERS, result: TO_REVIEW_RESULTS }).toString()}`,
    toDecide: filesHref(locale, LINK.used),
    openLinks: filesHref(locale, LINK.open),
  };
}

/** Nothing to do: every figure the person has is zero (the section is then one line, « Rien à traiter »). */
export const nothingToDo = (todo: Pick<ToDo, "toReview" | "toDecide" | "openLinks">): boolean =>
  todo.toReview === 0 && !todo.toDecide && !todo.openLinks;

export const HOME_PERIODS = ["7d", "30d", "90d"] as const;
export type HomePeriod = (typeof HOME_PERIODS)[number];
export const HOME_PERIOD_KEY = "period";
const DEFAULT_PERIOD: HomePeriod = "30d";
export const PERIOD_DAYS: Record<HomePeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** The period named by the address; an unknown or missing one is 30 days. */
export const homePeriodOf = (raw: string | null | undefined): HomePeriod =>
  HOME_PERIODS.find((p) => p === raw) ?? DEFAULT_PERIOD;

/** The calendar day `back` days before `day` (YYYY-MM-DD): calendar arithmetic on the date alone, no zone, no DST. */
function dayBefore(day: string, back: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return localDay(new Date(Date.UTC(y, m - 1, d - back)), "UTC");
}

/** The first day of a period ending today (in Québec), for the query's lower bound. */
export const periodFirstDay = (period: HomePeriod, now: Date, zone = DISPLAY_TIME_ZONE): string =>
  dayBefore(localDay(now, zone), PERIOD_DAYS[period] - 1);

export interface ActivityDay {
  day: string;
  checks: number;
}

/** The checks of each day of the period, in Québec, oldest first: every day present (zero included), nothing outside it. */
export function activityOf(
  at: readonly (string | Date)[],
  period: HomePeriod,
  now: Date,
  zone = DISPLAY_TIME_ZONE,
): ActivityDay[] {
  const today = localDay(now, zone);
  const days = Array.from({ length: PERIOD_DAYS[period] }, (_, i) => dayBefore(today, PERIOD_DAYS[period] - 1 - i));
  const counts = new Map(days.map((d) => [d, 0]));
  for (const instant of at) {
    const day = localDay(instant, zone);
    const n = counts.get(day);
    if (n !== undefined) counts.set(day, n + 1);
  }
  return days.map((day) => ({ day, checks: counts.get(day) ?? 0 }));
}
