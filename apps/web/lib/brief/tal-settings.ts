import type { TalTable } from "./tal";

/**
 * The TAL's rate of the year as the administrator keeps it (yomizaka#554): settings `tal.rate.*` in the database, never a number in code.
 * It is laid over the shipped table (`content/tal/renewal-radar.json`, which keeps the notice windows): the year it names replaces
 * that year's entry. Basis points 0 or an unreadable source leave the table as it is, so the check makes no claim.
 * Source of the seed: the TAL's release of 2026-01-19 on https://www.quebec.ca/nouvelles/actualites/details/le-calcul-de-lajustement-des-loyers-en-2026-68053
 * (base percentage 3,1 % for leases starting 2026-04-02 to 2027-04-01). The full text of art. 1950 C.c.Q. could not be fetched from
 * legisquebec.gouv.qc.ca (403): the recourse wording stays as the issue states it, marked « lawyer review » in the legal checklist.
 */
export interface TalRateSetting {
  year: number;
  basisPoints: number;
  sourceUrl: string;
  enteredOn: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function withTalRate(table: TalTable, rate: TalRateSetting): TalTable {
  if (rate.basisPoints <= 0 || !DAY.test(rate.enteredOn) || !URL.canParse(rate.sourceUrl)) return table;
  const entry = { year: rate.year, enteredOn: rate.enteredOn, sourceUrl: rate.sourceUrl, components: [{ id: "adjustment", kind: "rate-of-rent" as const, basisPoints: rate.basisPoints }] };
  return { ...table, years: [...table.years.filter((y) => y.year !== rate.year), entry] };
}

type Reader = { get(key: "tal.rate.year" | "tal.rate.basisPoints" | "tal.rate.sourceUrl" | "tal.rate.enteredOn"): Promise<unknown> };

/** The table in force: the shipped one with the administrator's rate laid over it. */
export async function talTableFrom(settings: Reader, table: TalTable): Promise<TalTable> {
  const [year, basisPoints, sourceUrl, enteredOn] = await Promise.all([settings.get("tal.rate.year"), settings.get("tal.rate.basisPoints"), settings.get("tal.rate.sourceUrl"), settings.get("tal.rate.enteredOn")]);
  return withTalRate(table, { year: Number(year), basisPoints: Number(basisPoints), sourceUrl: String(sourceUrl), enteredOn: String(enteredOn) });
}
