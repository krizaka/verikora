/** Sizes and dates as the person's language writes them. */
export const INTL = { en: "en-CA", fr: "fr-CA" } as const;
/** The server and the browser both draw a date: one time zone (the product's, Montréal) so they write the same text. */
export const DISPLAY_TIME_ZONE = "America/Toronto";

export function formatBytes(bytes: number, locale: "en" | "fr"): string {
  const units = ["B", "kB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${new Intl.NumberFormat(INTL[locale], { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/** A calendar day (`2026-11-16`), not an instant: it names no time of day. */
const isDateOnly = (iso: string): boolean => iso.length === 10 && iso[4] === "-" && iso[7] === "-";

export function formatDate(iso: string | null | undefined, locale: "en" | "fr", withTime = false): string {
  if (!iso) return "";
  // A calendar day is read in UTC, so its midnight does not slide to the day before in Montréal.
  const dayOnly = isDateOnly(iso);
  return new Date(iso).toLocaleString(
    INTL[locale],
    withTime && !dayOnly
      ? { dateStyle: "medium", timeStyle: "short", timeZone: DISPLAY_TIME_ZONE }
      : { dateStyle: "medium", timeZone: dayOnly ? "UTC" : DISPLAY_TIME_ZONE },
  );
}
