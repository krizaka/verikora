import { type Coupon, COUPON_STATUS, DURATION, KIND, ON_EXHAUSTED, PURPOSE } from "@krizaka/coupons";
import { differenceInSeconds, subSeconds } from "@krizaka/time";
import { z } from "zod";

/**
 * The admin's create form, as strings the fields hold, and the payload the API takes from them (`newCoupon` of `admin-api.ts`). Pure, so a test reaches it:
 * the package re-checks every rule at the server, this only turns what was typed into numbers (a percent into basis points, dates into instants).
 */
const digits = z.string().regex(/^\d*$/);
const choice = <T extends Record<string, string>>(o: T) => z.enum(Object.values(o) as [T[keyof T], ...T[keyof T][]]);

// @fixed: the currency the product sells in (the price catalogue is CAD); a coupon of a fixed amount is in it
export const COUPON_CURRENCY = "cad";

export const DISCOUNT_TYPE = { percent: "percent", amount: "amount" } as const;

export const couponFormSchema = z.object({
  code: z.string().trim().min(1).max(60),
  kind: choice(KIND),
  purpose: choice(PURPOSE),
  partnerId: z.string(),
  startsAt: z.string().min(1),
  endsAt: z.string(),
  maxRedemptions: digits,
  maxPerAccount: z.string().regex(/^[1-9]\d*$/),
  newCustomersOnly: z.boolean(),
  discountType: choice(DISCOUNT_TYPE),
  percent: z.string().regex(/^(\d{1,2}(\.\d{1,2})?)?$/),
  amountOffMinor: z.number().int().min(0),
  duration: choice(DURATION),
  durationMonths: digits,
  minimumMinor: z.number().int().min(0),
  credits: digits,
  capPerDay: digits,
  capPerMonth: digits,
  creditsValidDays: digits,
  onExhausted: choice(ON_EXHAUSTED),
});
export type CouponForm = z.infer<typeof couponFormSchema>;

export const emptyCouponForm = (today: string): CouponForm => ({
  code: "",
  kind: KIND.discount,
  purpose: PURPOSE.promo,
  partnerId: "",
  startsAt: today,
  endsAt: "",
  maxRedemptions: "",
  maxPerAccount: "1",
  newCustomersOnly: false,
  discountType: DISCOUNT_TYPE.percent,
  percent: "",
  amountOffMinor: 0,
  duration: DURATION.once,
  durationMonths: "",
  minimumMinor: 0,
  credits: "",
  capPerDay: "",
  capPerMonth: "",
  creditsValidDays: "30",
  onExhausted: ON_EXHAUSTED.stop,
});

const count = (text: string): number | null => (text === "" ? null : Number(text));
// @fixed: basis points in a percent
const BP_PER_PERCENT = 100;
/** « 12.5 » percent is 1250 basis points, exactly (no float: the digits are split). */
export const basisPoints = (percent: string): number | null => {
  if (percent === "") return null;
  const [whole = "0", fraction = ""] = percent.split(".");
  return Number(whole) * BP_PER_PERCENT + Number(fraction.padEnd(2, "0"));
};

// @fixed: the product's calendar, the one the console draws every date in (`components/console/format.ts`); a window starts and ends on a day of this zone
const WINDOW_ZONE = "America/Toronto";

/** The instant a wall-clock time is in the zone: the zone's offset is read at that moment (DST included), then taken off. */
function instantIn(timeZone: string, day: string, time: string): Date {
  const wall = new Date(`${day}T${time}.000Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(wall)
      .map((p) => [p.type, p.value]),
  );
  const shown = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`,
  );
  return subSeconds(wall, differenceInSeconds(shown, wall));
}

/** A window runs on days of the product's calendar: it starts at 00:00:00 of its first day and ends at 23:59:59 of its last. */
const startOf = (day: string) => instantIn(WINDOW_ZONE, day, "00:00:00").toISOString();
const endOf = (day: string) => instantIn(WINDOW_ZONE, day, "23:59:59").toISOString();

/** The create payload for the typed values. The fields of the other kind are left out, so the package's CHECKs see only what applies. */
export function couponPayload(v: CouponForm): Record<string, unknown> {
  const common = {
    code: v.code,
    kind: v.kind,
    purpose: v.purpose,
    partnerId: v.partnerId === "" ? null : v.partnerId,
    startsAt: startOf(v.startsAt),
    endsAt: v.endsAt === "" ? null : endOf(v.endsAt),
    maxRedemptions: count(v.maxRedemptions),
    maxPerAccount: Number(v.maxPerAccount),
    newCustomersOnly: v.newCustomersOnly,
  };
  if (v.kind === KIND.credit) {
    return {
      ...common,
      credits: count(v.credits),
      capPerDay: count(v.capPerDay),
      capPerMonth: count(v.capPerMonth),
      creditsValidDays: count(v.creditsValidDays),
      onExhausted: v.purpose === PURPOSE.demo ? ON_EXHAUSTED.fallbackPaid : v.onExhausted,
    };
  }
  const amount = v.discountType === DISCOUNT_TYPE.amount;
  return {
    ...common,
    ...(amount
      ? { amountOffMinor: v.amountOffMinor, currency: COUPON_CURRENCY }
      : { percentOffBp: basisPoints(v.percent) }),
    duration: v.duration,
    durationMonths: v.duration === DURATION.repeating ? count(v.durationMonths) : null,
    minimumMinor: v.minimumMinor === 0 ? null : v.minimumMinor,
  };
}

export type CouponState = "active" | "paused" | "archived" | "notStarted" | "expired";

/** What the list shows: the stored status, or the computed one (« not started » and « expired » need no cron). */
export function stateOf(c: Pick<Coupon, "status" | "startsAt" | "endsAt">, now: Date): CouponState {
  if (c.status === COUPON_STATUS.archived) return "archived";
  if (c.status === COUPON_STATUS.paused) return "paused";
  if (new Date(c.startsAt) > now) return "notStarted";
  if (c.endsAt && new Date(c.endsAt) <= now) return "expired";
  return "active";
}
