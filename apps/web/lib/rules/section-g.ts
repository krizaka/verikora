import type { TalTable, TalYear } from "../brief/tal";

/**
 * Section G of the Québec lease (verikora#554, slice 1 of #104): the notice of the lowest rent paid in the twelve months before the
 * lease (art. 1896 C.c.Q., the mandatory form's section G, the same citation as QC-LEASE-008) against the new rent. Pure and
 * deterministic. It speaks only of the lease's figures — never of the landlord — and only from what the law and the TAL's table give:
 * a year the table does not hold, or a method that needs the building's own costs, gives no figure and no claim.
 * The recourse is the one of art. 1950 C.c.Q.: the tenant may ask the Tribunal administratif du logement to fix the rent.
 * Information, not legal advice (the messages say so); the rates are data (`content/tal/renewal-radar.json`), never a number here.
 */
export type PreviousRent =
  /** Section G states a figure, in integer cents per month. */
  | { kind: "stated"; cents: number }
  /** Section G is blank or missing. */
  | { kind: "blank" }
  /** Section G is crossed out, overwritten or otherwise altered. */
  | { kind: "altered" };

export interface SectionGInput {
  /** The rent of the new lease, in integer cents per month. */
  newRentCents: number;
  previousRent: PreviousRent;
  /** The year the new lease starts in: the TAL's rate of that year applies. */
  year: number;
  /** The building's change in cost for each `cost-per-door` component of the method (cents per door, per month), when known. */
  costChangeCents?: Readonly<Record<string, number>>;
}

export const SECTION_G_RULE = {
  id: "TS-G-001",
  /** The duty to state the lowest rent (the ruleset's QC-LEASE-008) and the recourse. */
  citations: { notice: "C.c.Q., art. 1896", recourse: "C.c.Q., art. 1950" },
} as const;

export type SectionGCode =
  "previous-blank" | "previous-altered" | "over-rate" | "within-rate" | "not-above-previous" | "no-rate";

export interface SectionGResult {
  ruleId: typeof SECTION_G_RULE.id;
  /** `finding` asks for a look; `ok` is a lease figure within the table; `no-claim` says nothing, for want of data. */
  status: "finding" | "ok" | "no-claim";
  code: SectionGCode;
  /** The articles behind the result. */
  citations: string[];
  /** The tenant's recourse is named only with a finding. */
  recourse: { citation: string; authority: "TAL" } | null;
  figures: {
    previousRentCents?: number;
    newRentCents: number;
    /** The highest rent the TAL's rate of the year gives from the previous rent. */
    maxRentCents?: number;
    excessCents?: number;
    increaseBasisPoints?: number;
  };
  /** The page and day of the rate that was used, to show beside the figure. */
  source: { url: string; enteredOn: string | null; year: number | null };
}

type Component = TalYear["components"][number];
const RATE_KINDS: ReadonlySet<string> = new Set(["rate-of-rent"]);
const isRateOfRent = (c: Component): c is Extract<Component, { basisPoints: number }> => RATE_KINDS.has(c.kind);

type Cap = { maxIncreaseCents: number; entry: TalYear } | { missing: "NO_YEAR" | "NO_BUILDING_COST" };

/** The increase the table allows on a rent for the year — rates of the rent plus costs the caller supplied; none when a figure is missing. */
function capOf(table: TalTable, year: number, previousCents: number, costs: SectionGInput["costChangeCents"]): Cap {
  const entry = table.years.find((y) => y.year === year);
  if (!entry) return { missing: "NO_YEAR" };
  let total = 0;
  for (const c of entry.components) {
    if (isRateOfRent(c)) {
      total += Math.round((previousCents * c.basisPoints) / 10_000);
      continue;
    }
    const change = costs?.[c.id];
    if (change === undefined) return { missing: "NO_BUILDING_COST" };
    total += change;
  }
  return { maxIncreaseCents: Math.max(0, total), entry };
}

const BLANK_KINDS = { blank: true, altered: false, stated: false } as const;

const recourse = { citation: SECTION_G_RULE.citations.recourse, authority: "TAL" } as const;

export function checkSectionG(input: SectionGInput, table: TalTable): SectionGResult {
  const { newRentCents, previousRent, year } = input;
  const base = { ruleId: SECTION_G_RULE.id, figures: { newRentCents } } as const;
  const sourceOf = (entry: TalYear | null) => ({
    url: entry?.sourceUrl ?? table.source.url,
    enteredOn: entry?.enteredOn ?? null,
    year: entry ? entry.year : null,
  });
  if (!("cents" in previousRent)) {
    const code = BLANK_KINDS[previousRent.kind] ? "previous-blank" : "previous-altered";
    return {
      ...base,
      status: "finding",
      code,
      citations: [SECTION_G_RULE.citations.notice, SECTION_G_RULE.citations.recourse],
      recourse,
      source: sourceOf(null),
    };
  }
  const previous = previousRent.cents;
  if (!Number.isInteger(previous) || previous <= 0 || !Number.isInteger(newRentCents) || newRentCents <= 0) {
    return { ...base, status: "no-claim", code: "no-rate", citations: [], recourse: null, source: sourceOf(null) };
  }
  const figures = {
    previousRentCents: previous,
    newRentCents,
    increaseBasisPoints: Math.round(((newRentCents - previous) * 10_000) / previous),
  };
  if (newRentCents <= previous)
    return {
      ...base,
      figures,
      status: "ok",
      code: "not-above-previous",
      citations: [SECTION_G_RULE.citations.notice],
      recourse: null,
      source: sourceOf(null),
    };
  const cap = capOf(table, year, previous, input.costChangeCents);
  if ("missing" in cap)
    return {
      ...base,
      figures,
      status: "no-claim",
      code: "no-rate",
      citations: [SECTION_G_RULE.citations.notice],
      recourse: null,
      source: sourceOf(null),
    };
  const maxRentCents = previous + cap.maxIncreaseCents;
  const withMax = { ...figures, maxRentCents };
  if (newRentCents <= maxRentCents)
    return {
      ...base,
      figures: withMax,
      status: "ok",
      code: "within-rate",
      citations: [SECTION_G_RULE.citations.notice],
      recourse: null,
      source: sourceOf(cap.entry),
    };
  return {
    ...base,
    figures: { ...withMax, excessCents: newRentCents - maxRentCents },
    status: "finding",
    code: "over-rate",
    citations: [SECTION_G_RULE.citations.notice, SECTION_G_RULE.citations.recourse],
    recourse,
    source: sourceOf(cap.entry),
  };
}

/** The message key of a result, under `sectionG.<code>` in the catalogues. */
export const sectionGMessageKey = (r: Pick<SectionGResult, "code">) => `sectionG.${r.code}` as const;
