/**
 * The deadline to ask the TAL to fix the rent (verikora#562, slice 4 of #104), the recourse of art. 1950 C.c.Q. that Section G (#554) points to.
 * Source: the TAL's page « Avis au nouveau locataire » — the request is made within 10 days of the conclusion of the lease when the landlord gave the
 * notice; within two months of the start of the lease when no notice was given; within two months of learning of it when the notice held a false statement.
 * Pure: dates are `YYYY-MM-DD` strings, `today` is a parameter (no clock). Information about dates, not legal advice. LAWYER REVIEW: how days and months are
 * counted (the article's text could not be read from the session) — see docs/compliance-gate.md.
 */
export const SECTION_G_DEADLINE_SOURCE = {
  citation: "C.c.Q., art. 1950",
  url: "https://www.tal.gouv.qc.ca/fr/signature-d-un-bail/avis-au-nouveau-locataire",
} as const;

export type LandlordNotice = { kind: "given" } | { kind: "not-given" } | { kind: "false"; knownOn: string };
export type DeadlineBasis = "ten-days" | "two-months-from-start" | "two-months-from-knowledge";
export type DeadlineState = "open" | "last-day" | "closed" | "no-claim";

export interface SectionGDeadlineInput {
  concludedOn: string;
  startsOn: string;
  notice: LandlordNotice;
  today: string;
}

export interface SectionGDeadline {
  state: DeadlineState;
  basis: DeadlineBasis | null;
  lastDay: string | null;
  daysLeft: number | null;
  citation: typeof SECTION_G_DEADLINE_SOURCE.citation;
  sourceUrl: typeof SECTION_G_DEADLINE_SOURCE.url;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar days are counted on the civil calendar (days since 1970-01-01, Howard Hinnant's algorithm): no clock, no time zone, no library. */
function daysFromCivil(y: number, m: number, d: number): number {
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(z: number): [number, number, number] {
  const shifted = z + 719_468;
  const era = Math.floor(shifted / 146_097);
  const doe = shifted - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const show = (days: number): string => {
  const [y, m, d] = civilFromDays(days);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const lastDayOfMonth = (y: number, m: number): number =>
  daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);

/** A real calendar day written `YYYY-MM-DD`, as its day number, or null. */
function parse(iso: string): number | null {
  const match = ISO.exec(iso);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const days = daysFromCivil(y, m, d);
  return show(days) === iso ? days : null;
}

/** `iso` plus whole months; a month end lands on the last day of the target month. */
export function addMonthsIso(iso: string, months: number): string {
  const days = parse(iso);
  if (days === null) throw new Error(`not a date: ${iso}`);
  const [y, m, d] = civilFromDays(days);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return show(daysFromCivil(ny, nm, Math.min(d, lastDayOfMonth(ny, nm))));
}

const noClaim: SectionGDeadline = {
  state: "no-claim",
  basis: null,
  lastDay: null,
  daysLeft: null,
  citation: SECTION_G_DEADLINE_SOURCE.citation,
  sourceUrl: SECTION_G_DEADLINE_SOURCE.url,
};

function lastDayOf(input: SectionGDeadlineInput): { basis: DeadlineBasis; lastDay: string } | null {
  const { notice } = input;
  switch (notice.kind) {
    case "given": {
      const concluded = parse(input.concludedOn);
      return concluded !== null ? { basis: "ten-days", lastDay: show(concluded + 10) } : null;
    }
    case "not-given":
      return parse(input.startsOn)
        ? { basis: "two-months-from-start", lastDay: addMonthsIso(input.startsOn, 2) }
        : null;
    default:
      return parse(notice.knownOn)
        ? { basis: "two-months-from-knowledge", lastDay: addMonthsIso(notice.knownOn, 2) }
        : null;
  }
}

function stateOf(daysLeft: number): DeadlineState {
  if (daysLeft < 0) return "closed";
  return daysLeft === 0 ? "last-day" : "open";
}

export function sectionGDeadline(input: SectionGDeadlineInput): SectionGDeadline {
  const today = parse(input.today);
  const found = today === null ? null : lastDayOf(input);
  const last = found ? parse(found.lastDay) : null;
  if (today === null || !found || last === null) return noClaim;
  const daysLeft = last - today;
  return {
    ...noClaim,
    state: stateOf(daysLeft),
    basis: found.basis,
    lastDay: found.lastDay,
    daysLeft: Math.max(daysLeft, 0),
  };
}
