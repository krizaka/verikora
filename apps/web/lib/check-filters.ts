import { DOCUMENT_KINDS, DOCUMENT_STATUSES, type DocumentKind, type DocumentStatus } from "@verikora/core";
import { differenceInMinutes, isBefore, subHours, subMinutes } from "date-fns";

import { DISPLAY_TIME_ZONE } from "@/components/console/format";
import type { CheckSummary } from "@/lib/checks";

import { readFilterParams, writeFilterParams } from "./filter-params";

/** The filters of the Vérifications list, each a key in the address (`?q=bail&result=attention,failed&kind=lease&period=30d`) — the URL is the state (§ 7). */
export const CHECK_FILTER_KEYS = ["q", "result", "kind", "period"] as const;
/** A check's results worth filtering on — never « stored »: a document that was never checked is not a check. */
export const CHECK_RESULTS: readonly DocumentStatus[] = DOCUMENT_STATUSES.filter((s) => s !== "stored");
export const CHECK_PERIODS = ["7d", "30d", "year"] as const;
export type CheckPeriod = (typeof CHECK_PERIODS)[number];

export interface CheckFilters {
  /** Words looked for in the document's title. */
  q: string;
  result: readonly DocumentStatus[];
  kind: readonly DocumentKind[];
  period: CheckPeriod | null;
}
export const NO_CHECK_FILTERS: CheckFilters = { q: "", result: [], kind: [], period: null };

const known = <V extends string>(values: readonly string[], vocabulary: readonly V[]): V[] =>
  vocabulary.filter((v) => values.includes(v));

/** The filters an address carries — an unknown value is dropped, so a stale link never breaks the page. */
export function readCheckFilters(search: string | URLSearchParams): CheckFilters {
  const read = readFilterParams(typeof search === "string" ? new URLSearchParams(search) : search, CHECK_FILTER_KEYS);
  return {
    q: (read.q ?? []).join(" ").trim(),
    result: known(read.result ?? [], CHECK_RESULTS),
    kind: known(read.kind ?? [], DOCUMENT_KINDS),
    period: CHECK_PERIODS.find((p) => (read.period ?? []).includes(p)) ?? null,
  };
}

/** The address with these filters: the other keys (the tab) kept, an empty filter removed, several values comma-separated. */
export function writeCheckFilters(base: URLSearchParams, filters: CheckFilters): URLSearchParams {
  return writeFilterParams(base, {
    q: filters.q.trim() || null,
    result: filters.result,
    kind: filters.kind,
    period: filters.period,
  });
}

export const hasCheckFilters = (f: CheckFilters): boolean =>
  f.q.length > 0 || f.result.length > 0 || f.kind.length > 0 || f.period !== null;

const HOURS_IN_DAY = 24;

/** The minutes a zone is ahead of UTC at an instant (Intl only, no library). */
function offsetMinutes(zone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return differenceInMinutes(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)),
    at,
  );
}

/** The first instant of `now`'s year in a zone — the console's (America/Toronto) on both sides, so the server and the browser keep the same rows. */
function startOfYearIn(zone: string, now: Date): Date {
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric" }).format(now));
  const guess = new Date(Date.UTC(year, 0, 1));
  return subMinutes(guess, offsetMinutes(zone, guess));
}

/** When a period starts, from `now`: the last 7 or 30 days (instants — no local calendar, no DST shift), or this year in the console's zone. */
export function periodStart(period: CheckPeriod, now: Date, zone = DISPLAY_TIME_ZONE): Date {
  if (period === "year") {
    return startOfYearIn(zone, now);
  }
  const days = period === "7d" ? 7 : 30;
  return subHours(now, HOURS_IN_DAY * days);
}

/** The search field's draft against the address: our own commit landing retires the draft unless a newer edit is in flight; a change made elsewhere (a chip, « Effacer », back) replaces it. */
export interface DraftState {
  /** What is typed and not yet in the address; null when the field shows the address. */
  draft: string | null;
  /** The last query we committed to the address. */
  pending: string;
  /** The last query the address gave us. */
  seen: string;
}
export function reconcileDraft(state: DraftState, q: string): DraftState {
  if (q === state.seen) {
    return state;
  }
  if (q === state.pending) {
    return { ...state, seen: q, draft: state.draft === q ? null : state.draft };
  }
  return { draft: null, pending: q, seen: q };
}

/** How a filter change enters the history: a choice (a menu, a chip, « Effacer ») is a step Back undoes; typing is one act, replaced as it goes. */
export const FILTER_HISTORY = { chosen: "push", typed: "replace" } as const;
export type FilterHistory = (typeof FILTER_HISTORY)[keyof typeof FILTER_HISTORY];

/** Text without its accents and case, for the search (« Dépôt » matches « depot »). */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The rows the filters keep: every word of the query in the title; the result, the kind and the period match. */
export function applyCheckFilters(rows: readonly CheckSummary[], f: CheckFilters, now: Date): CheckSummary[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  const since = f.period ? periodStart(f.period, now) : null;
  return rows.filter((c) => {
    if (words.length && !words.every((w) => fold(c.title).includes(w))) {
      return false;
    }
    if (f.result.length && !f.result.includes(c.result)) {
      return false;
    }
    if (f.kind.length && !f.kind.includes(c.kind)) {
      return false;
    }
    if (since && isBefore(new Date(c.at), since)) {
      return false;
    }
    return true;
  });
}

/** How many rows each value of one filter would give, with the other filters in force — the count on the menu's options. */
export function countByValue(
  rows: readonly CheckSummary[],
  f: CheckFilters,
  key: "result" | "kind",
  now: Date,
): Record<string, number> {
  const base = applyCheckFilters(rows, { ...f, [key]: [] }, now);
  const counts: Record<string, number> = {};
  for (const c of base) {
    counts[c[key]] = (counts[c[key]] ?? 0) + 1;
  }
  return counts;
}

/** The same for the periods: how many rows each period keeps, the other filters in force. */
export function countByPeriod(rows: readonly CheckSummary[], f: CheckFilters, now: Date): Record<CheckPeriod, number> {
  const base = applyCheckFilters(rows, { ...f, period: null }, now);
  return Object.fromEntries(
    CHECK_PERIODS.map((p) => [p, applyCheckFilters(base, { ...NO_CHECK_FILTERS, period: p }, now).length]),
  ) as Record<CheckPeriod, number>;
}
