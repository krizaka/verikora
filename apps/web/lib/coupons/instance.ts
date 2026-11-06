import { COUPON_ATTEMPT_ACTION, CouponError, createCoupons } from "@krizaka/coupons";
import { couponAttemptLimit, readCouponSettings } from "@krizaka/coupons/settings";
import { createLimiter, memoryLimitStore } from "@krizaka/rate-limit";

import { systemClock } from "../../app/system-clock";
import { trail } from "../audit";
import { ledger } from "../audit-credits";
import { HttpError } from "../http";
import { logError } from "../log";
import { appSettings } from "../settings/instance";

/**
 * The coupons of the product (`@krizaka/coupons`, ADR-002, verikora#262): our database is the source of truth (schema `coupons`), the processor applies
 * a discount from immutable terms (never a Stripe promotion code), and a credit coupon grants capped, expiring credits on the same ledger as the
 * audit credits. Off until the owner turns `coupons.enabled` on.
 */
const settings = () => readCouponSettings((key) => appSettings().get(key) as Promise<boolean | number | undefined>);

/** The attempts with a code, counted before any lookup: per address and per account, the numbers are the admin's settings. */
const attempts = createLimiter({
  store: memoryLimitStore(),
  clock: systemClock,
  limits: async (action) => (action === COUPON_ATTEMPT_ACTION ? couponAttemptLimit(await settings()) : undefined),
  onStoreError: (error, action) => logError(`coupons: limiter store failed for ${action}`, error),
});

export const coupons = createCoupons({
  clock: systemClock,
  settings,
  audit: trail,
  rateLimit: attempts,
  credits: ledger,
});

/** A refusal of the package, as the API answers it (the code is the client's message key; `Retry-After` on a rate limit). */
export function couponRefusal(error: unknown): unknown {
  if (!(error instanceof CouponError)) return error;
  const headers: Record<string, string> =
    error.retryAfterSeconds === undefined ? {} : { "Retry-After": String(error.retryAfterSeconds) };
  return new HttpError(
    error.status,
    error.message,
    {
      code: error.code,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    },
    headers,
  );
}

/** Runs the work and turns a package refusal into the API's. */
export async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw couponRefusal(error);
  }
}
