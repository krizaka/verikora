import type { Query } from "@krizaka/db";

import { longDate, money } from "./format";

/**
 * The launch offer the pricing page announces (ADR-0013 amendment, verikora#548). It is NOT typed anywhere: it is a promo code the
 * administrator created at /config/coupons (percent, months, plans, dates, uses), and the setting `pricing.announcedCode` names the one
 * to announce. The page reads that coupon; checkout applies it with the same rules (`coupons.apply`), so the page can never promise
 * what the checkout refuses. Québec consumer protection: the regular price and the end of the offer are always shown.
 */
export interface LaunchOffer {
  code: string;
  percent: number;
  months: number;
  /** The plans it applies to (empty: every subscription). */
  plans: readonly string[];
  endsAt: Date | null;
}

interface CouponRow {
  code: string;
  percent_off_bp: number;
  duration_months: number;
  plans: string[];
  ends_at: Date | null;
}

// @fixed: basis points in a percent
const BP_PER_PERCENT = 100;

/** The announced coupon if it is a running percentage discount over several months (active, started, not ended); null otherwise, and the page announces nothing. */
export async function activeLaunchOffer(query: Query, code: string, now: Date): Promise<LaunchOffer | null> {
  const typed = code.trim();
  if (typed === "") return null;
  const [row] = await query<CouponRow>(
    `SELECT code, percent_off_bp, duration_months, plans, ends_at FROM coupons.coupon
      WHERE code_key = upper($1) AND kind = 'discount' AND status = 'active' AND duration = 'repeating' AND percent_off_bp IS NOT NULL
        AND starts_at <= $2 AND (ends_at IS NULL OR ends_at > $2)`,
    [typed, now],
  );
  return row
    ? {
        code: row.code,
        percent: row.percent_off_bp / BP_PER_PERCENT,
        months: row.duration_months,
        plans: row.plans,
        endsAt: row.ends_at,
      }
    : null;
}

/** What one plan costs in each period of the offer: the discounted amount for `months` months, then the regular one. Integer cents, rounded to the nearest. */
export interface OfferPrice {
  plan: string;
  regularCents: number;
  offerCents: number;
  months: number;
}

export function offerPrices(offer: LaunchOffer, plans: readonly { plan: string; amountCents: number }[]): OfferPrice[] {
  return plans
    .filter((p) => (offer.plans.length === 0 || offer.plans.includes(p.plan)) && p.amountCents > 0)
    .map((p) => ({
      plan: p.plan,
      regularCents: p.amountCents,
      offerCents: Math.round((p.amountCents * (100 - offer.percent)) / 100),
      months: offer.months,
    }));
}

/** The amount billed on month `n` (1 = the first): the offer's for the first `months` months, the regular price after. */
export const billedOnMonth = (price: OfferPrice, n: number): number =>
  n <= price.months ? price.offerCents : price.regularCents;

/** The strings the page shows for the offer, from the messages (`pricing.offer.*`): the headline and each plan's line, regular price and end date included. */
export function offerLines(
  offer: LaunchOffer,
  prices: readonly OfferPrice[],
  locale: "en" | "fr",
  say: { headline: string; line: string; ends: string; always: string },
  fill: (message: string, values: Record<string, string | number>) => string,
): { headline: string; ends: string; lines: { plan: string; text: string }[] } {
  const date = offer.endsAt ? longDate(offer.endsAt, locale) : null;
  return {
    headline: fill(say.headline, { percent: offer.percent, months: offer.months, code: offer.code }),
    ends: date ? fill(say.ends, { date }) : say.always,
    lines: prices.map((p) => ({
      plan: p.plan,
      text: fill(say.line, {
        offer: money(p.offerCents, locale),
        months: p.months,
        regular: money(p.regularCents, locale),
      }),
    })),
  };
}
