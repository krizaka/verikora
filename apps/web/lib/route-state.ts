import { DOCUMENT_KINDS } from "@verikora/core";

import { CHECKS_TAB_KEY, CHECKS_TABS, type ChecksTab } from "./console-nav";

/** A choice that lives in the address: `?<key>=<value>`, one of a closed list, absent when it is the default. */
export interface RouteState<V extends string> {
  key: string;
  values: readonly V[];
  fallback: V;
}

/** The kinds a check can be asked for: the document kinds' own words, plus « let Verikora decide ». */
export const CHECK_KINDS = ["auto", ...DOCUMENT_KINDS] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export const KEEP_CHOICES = ["0", "1"] as const;
export type KeepChoice = (typeof KEEP_CHOICES)[number];
export const GROUP_CHOICES = ["0", "1"] as const;
export type GroupChoice = (typeof GROUP_CHOICES)[number];

/** The groups of the check catalogue (« Baux », « Factures »…), and « Toutes » as the default of its chips. */
export const CATALOGUE_GROUPS = ["lease", "invoice", "contract", "notice", "authenticity"] as const;
export const CATALOGUE_FILTERS = ["all", ...CATALOGUE_GROUPS] as const;
export type CatalogueFilter = (typeof CATALOGUE_FILTERS)[number];

/** Every route-state of the app, so one test table covers them all. */
export const ROUTE_STATES = {
  checkKind: {
    path: "/app/check",
    state: { key: "type", values: CHECK_KINDS, fallback: "auto" } satisfies RouteState<CheckKind>,
  },
  /** The chip of the check catalogue that is chosen (« Toutes » by default). */
  catalogueGroup: {
    path: "/app/check",
    state: { key: "groupe", values: CATALOGUE_FILTERS, fallback: "all" } satisfies RouteState<CatalogueFilter>,
  },
  /** Several photos dropped together are the pages of one document (the default), or separate documents. */
  groupPhotos: {
    path: "/app/check",
    state: { key: "pages", values: GROUP_CHOICES, fallback: "1" } satisfies RouteState<GroupChoice>,
  },
  keepDocuments: {
    path: "/app/check",
    state: { key: "conserver", values: KEEP_CHOICES, fallback: "0" } satisfies RouteState<KeepChoice>,
  },
  /** The tab of the Vérifications destination: the list of checks, or the batches (« Lots »). */
  checksTab: {
    path: "/app/verifications",
    state: { key: CHECKS_TAB_KEY, values: CHECKS_TABS, fallback: "checks" } satisfies RouteState<ChecksTab>,
  },
} as const;

/** The value in the address; an unknown or missing one is the default (a stale link never breaks the page). */
export function readRouteValue<V extends string>(search: string, { key, values, fallback }: RouteState<V>): V {
  const raw = new URLSearchParams(search).get(key);
  return values.find((v) => v === raw) ?? fallback;
}

/** The address with `value` chosen: the other parameters stay, the default leaves the address clean. */
export function routeHref<V extends string>(
  path: string,
  search: string,
  { key, fallback }: RouteState<V>,
  value: V,
): string {
  const params = new URLSearchParams(search);
  if (value === fallback) params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
