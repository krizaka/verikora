import { COUPON_STATUS, DURATION, KIND, ON_EXHAUSTED, PURPOSE, REDEMPTION_STATUS } from "@krizaka/coupons";
import { z } from "zod";

import { refuse } from "../http";

/** What the admin's coupon routes accept, as schemas (the package re-checks every rule: a free discount, a missing cap or an unlimited credit cannot be stored). */
const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];
const date = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const count = z.number().int().positive().nullable().optional();

// @fixed: the longest page the console asks for; a list is read page by page
const PAGE_MAX = 200;
// @fixed: the page the console shows by default
const PAGE_DEFAULT = 50;

const terms = {
  maxRedemptions: count,
  maxPerAccount: z.number().int().positive().optional(),
  newCustomersOnly: z.boolean().optional(),
  plans: z.array(z.string().min(1).max(40)).max(20).optional(),
  percentOffBp: z.number().int().positive().nullable().optional(),
  amountOffMinor: z.number().int().positive().nullable().optional(),
  currency: z
    .string()
    .regex(/^[a-z]{3}$/)
    .nullable()
    .optional(),
  duration: z.enum(values(DURATION)).nullable().optional(),
  durationMonths: z.number().int().positive().nullable().optional(),
  minimumMinor: z.number().int().min(0).nullable().optional(),
  credits: count,
  capPerDay: count,
  capPerMonth: count,
  creditsValidDays: count,
  onExhausted: z.enum(values(ON_EXHAUSTED)).nullable().optional(),
};

export const newCoupon = z.object({
  code: z.string().trim().min(1).max(60),
  kind: z.enum(values(KIND)),
  purpose: z.enum(values(PURPOSE)),
  partnerId: z.uuid().nullable().optional(),
  startsAt: date,
  endsAt: date.nullable().optional(),
  ...terms,
});

export const couponPatch = z
  .object({
    purpose: z.enum(values(PURPOSE)),
    partnerId: z.uuid().nullable(),
    startsAt: date,
    endsAt: date.nullable(),
    status: z.enum(values(COUPON_STATUS)),
    ...terms,
  })
  .partial()
  .strict();

export const couponAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("revoke"), redemptionId: z.uuid() }),
]);

export const newPartner = z.object({
  displayName: z.string().trim().min(1).max(80),
  contactEmail: z.email().max(200).nullable().optional(),
});
export const partnerAction = z.object({ action: z.enum(["archive", "restore", "erase"]) });

const optional = <T extends z.ZodType>(schema: T) => schema.optional();
const page = {
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
};

export const couponQuery = z.object({
  status: optional(z.enum(values(COUPON_STATUS))),
  kind: optional(z.enum(values(KIND))),
  purpose: optional(z.enum(values(PURPOSE))),
  partnerId: optional(z.uuid()),
  ...page,
});
export const redemptionQuery = z.object({ status: optional(z.enum(values(REDEMPTION_STATUS))), ...page });
export const periodQuery = z.object({ from: optional(date), to: optional(date) });

/**
 * A pilot's allowance is followed by payment: once the free files are used the account's own credits take over (`fallback_paid`). With `stop` the pot would
 * refuse the next file even after a payment, so a pilot code (purpose « demo », credit kind) is always stored with `fallback_paid`.
 */
export function pilotFallsBackToPaid<T extends { onExhausted?: string | null }>(
  purpose: string | undefined,
  input: T,
): T {
  return purpose === PURPOSE.demo && input.onExhausted !== undefined
    ? { ...input, onExhausted: ON_EXHAUSTED.fallbackPaid }
    : input;
}

/** A search string's entries as a plain object (the first value of each key), for a schema. */
export const paramsOf = (url: string): Record<string, string> =>
  Object.fromEntries(new URL(url).searchParams.entries());

/** Parses the query string against a schema: a bad value is a 400 naming the fields, never the values. */
export function parseParams<T>(
  schema: {
    safeParse: (
      v: unknown,
    ) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } };
  },
  url: string,
): T {
  const parsed = schema.safeParse(paramsOf(url));
  if (!parsed.success)
    throw refuse(400, "BAD_REQUEST", "Invalid query", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  return parsed.data;
}
