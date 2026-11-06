import { z } from "zod";

import table from "../../content/tal/renewal-radar.json";

/**
 * The data of the renewal radar (verikora#228): the notice windows of art. 1942 C.c.Q. and the TAL's yearly figures, entered one
 * year at a time with their source — never a percentage in code. The file is `content/tal/renewal-radar.json`.
 */
const dayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const window = z.object({
  id: z.string(),
  citation: z.string(),
  /** The lease durations it applies to, in months (inclusive). */
  minMonths: z.number().int().min(1),
  maxMonths: z.number().int().optional(),
  /** The notice is given between `opensMonthsBefore` and `closesMonthsBefore` months before the end of the lease. */
  opensMonthsBefore: z.number().int().min(1),
  closesMonthsBefore: z.number().int().min(1),
});

/** One component of the TAL's method for a year: a rate applied to the current rent, or a cost the building's own data supplies. */
const component = z.discriminatedUnion("kind", [
  /** A share of the current rent, in basis points (the TAL's published adjustment rates). */
  z.object({ id: z.string(), kind: z.literal("rate-of-rent"), basisPoints: z.number().int() }),
  /** A change in the building's cost (taxes, insurance, services, repairs…), in cents per door and per month, read from the building's data. */
  z.object({ id: z.string(), kind: z.literal("cost-per-door") }),
]);

const year = z.object({
  year: z.number().int(),
  /** The day the figures were entered, and the page they were read from: shown with every figure. */
  enteredOn: dayText,
  sourceUrl: z.string().url(),
  components: z.array(component).min(1),
});

export const talTable = z.object({
  source: z.object({ label: z.string(), url: z.string().url() }),
  windows: z.array(window).min(1),
  /** The reminder: how many days before a window closes the radar says it is closing. */
  alerts: z.object({ reminderDays: z.number().int().min(0) }),
  years: z.array(year),
});
export type TalTable = z.infer<typeof talTable>;
export type TalYear = z.infer<typeof year>;
export type NoticeWindowRule = z.infer<typeof window>;

/** The table in force, validated at load: a malformed entry stops the build, it is never half read. */
export const TAL: TalTable = talTable.parse(table);
