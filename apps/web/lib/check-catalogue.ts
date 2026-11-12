import { type Jurisdiction, JURISDICTIONS, type Studio } from "@verikora/core";

import { CONSOLE_ROUTES } from "./console-nav";
import type { CreditsFigure } from "./home-b2";
import { CATALOGUE_GROUPS, type CheckKind, ROUTE_STATES } from "./route-state";

/*
 * « Vérifier un document », B2 (verikora#333, design § 5.4/5.6): the catalogue of the checks Verikora runs, its chips with their
 * counts, the action that names the kind and leads to the drop, and the plan strip. Pure. The catalogue is **the registry**: the
 * rulesets and Studios the flows offer (`offerOf`) — a ruleset the registry does not run is not listed, and one that has no
 * words here yet is left out until it has (never a raw id on screen).
 */

export const GROUPS = CATALOGUE_GROUPS;
export type Group = (typeof GROUPS)[number];

/** What each ruleset the pack carries is: its group, its jurisdiction and the kind its action names (a kind Verikora recognises from the file otherwise). */
const RULESETS: Record<string, { group: Exclude<Group, "authenticity">; jurisdiction: Jurisdiction; kind: CheckKind }> =
  {
    "qc-residential-lease": { group: "lease", jurisdiction: "QC", kind: "lease" },
    "fr-residential-lease": { group: "lease", jurisdiction: "FR", kind: "lease" },
    "be-residential-lease": { group: "lease", jurisdiction: "BE-WAL", kind: "lease" },
    "qc-invoice": { group: "invoice", jurisdiction: "QC", kind: "invoice" },
    "qc-service-contract": { group: "contract", jurisdiction: "QC", kind: "contract" },
    "qc-visit-notice": { group: "notice", jurisdiction: "QC", kind: "auto" },
    "qc-premises-condition": { group: "notice", jurisdiction: "QC", kind: "auto" },
  };

export interface CatalogueItem {
  /** The ruleset's id, or `authenticity`. */
  id: string;
  group: Group;
  jurisdiction: Jurisdiction | null;
  kind: CheckKind;
}

/**
 * The checks that run for a person: the registry's rulesets (those with words) and, when its Studio is offered, the file's
 * authenticity. With a `territory` (the account's, e.g. `"QC"`) the catalogue is **filtered**: only that jurisdiction's checks
 * and the file's authenticity (which belongs to no jurisdiction), the territory's lease first, then authenticity, then the rest.
 * No territory, or « another territory » (`ZZ`, not a jurisdiction), lists every check, authenticity last.
 */
export function catalogueOf(
  offer: { studios: readonly Studio[]; rulesets: readonly string[] },
  territory: string | null = null,
): CatalogueItem[] {
  const seen = new Set<string>();
  const rulesets = offer.rulesets.flatMap((r) => {
    const id = rulesetId(r);
    const known = RULESETS[id];
    if (!known || seen.has(id)) return [];
    seen.add(id);
    return [{ id, ...known }];
  });
  // The groups' order, then the order the registry lists them in (Québec first, our market).
  const ordered = GROUPS.flatMap((g) => rulesets.filter((r) => r.group === g)) as CatalogueItem[];
  const authenticity: CatalogueItem | null = offer.studios.includes("document-authenticity")
    ? { id: "authenticity", group: "authenticity", jurisdiction: null, kind: "auto" }
    : null;
  if (territory && (JURISDICTIONS as readonly string[]).includes(territory)) {
    const here = ordered.filter((r) => r.jurisdiction === territory);
    const lease = here.filter((r) => r.group === "lease");
    return [...lease, ...(authenticity ? [authenticity] : []), ...here.filter((r) => r.group !== "lease")];
  }
  return authenticity ? [...ordered, authenticity] : ordered;
}

/** A dated ruleset (`qc-residential-lease/2026-10-24`) is its lease (the same rule as `rulesetId` of lib/flows, which reads the database: not imported into the browser). */
const rulesetId = (ruleset: string): string => ruleset.split("/")[0] ?? ruleset;

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
const matches = (label: string, q: string) => !q || plain(label).includes(plain(q));

export interface Chip {
  /** `null` is « Toutes ». */
  group: Group | null;
  count: number;
}

/** « Toutes · 6 », then a chip per group the registry has with the checks that match the search (a group with none left keeps its chip at 0). */
export function chipsOf(items: readonly CatalogueItem[], q: string, labelOf: (item: CatalogueItem) => string): Chip[] {
  const found = items.filter((i) => matches(labelOf(i), q));
  return [
    { group: null, count: found.length },
    ...GROUPS.filter((g) => items.some((i) => i.group === g)).map((g) => ({
      group: g,
      count: found.filter((i) => i.group === g).length,
    })),
  ];
}

/** The rows shown: the chosen group's checks that match the search. */
export const visibleItems = (
  items: readonly CatalogueItem[],
  { group, q }: { group: Group | null; q: string },
  labelOf: (item: CatalogueItem) => string,
): CatalogueItem[] => items.filter((i) => (!group || i.group === group) && matches(labelOf(i), q));

/** The action of a row: it names the kind in the address (`?type=`, the app's own state) and leads to the drop. « auto » leaves the address clean. */
export const checkHref = (locale: "en" | "fr", kind: CheckKind): string => {
  const { fallback, key } = ROUTE_STATES.checkKind.state;
  const query = kind === fallback ? "" : `?${key}=${kind}`;
  return `/${locale}${CONSOLE_ROUTES.check}${query}#depot`;
};

export interface PlanStripModel {
  plan: CreditsFigure["kind"];
  figures: { id: "left"; value: number }[];
  meter: { value: number; max: number } | null;
}

/** The plan strip from the billing state: Pro measures its audits against the fair-use cap (the meter says « 18 sur 100 »); credits are a number left; an operator-made account has none to count. */
export function planStrip(figure: CreditsFigure): PlanStripModel {
  switch (figure.kind) {
    case "pro":
      return { plan: "pro", figures: [], meter: { value: figure.used, max: figure.cap } };
    case "credits":
      return { plan: "credits", figures: [{ id: "left", value: figure.left }], meter: null };
    default:
      return { plan: "included", figures: [], meter: null };
  }
}
