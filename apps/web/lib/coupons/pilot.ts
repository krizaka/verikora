import { COUPON_CODE, COUPON_STATUS_CODE, type CreditRedemption, KIND, normalizeCode, PURPOSE } from "@krizaka/coupons";
import type { Query } from "@krizaka/db";

import { audit } from "../audit";
import { query, transaction } from "../db";
import { HttpError, refuse } from "../http";
import { hasPaidBefore } from "./checkout";
import { coupons, guarded } from "./instance";

/**
 * The free pilot (krizaka-internal#3230): a **credit code** the admin creates with the purpose « demo » (shown as « Pilot » in the console), whose credits are the number of
 * files, whose validity is the pot's expiry (`creditsValidDays`) and whose cap is `maxRedemptions`. Nothing about it is typed in code. The package's own rules answer
 * unknown, expired, exhausted and already-used codes (`COUPON_*`); what is added here is **one pilot per account**, whatever the code, under the account's row lock.
 */
export const PILOT_PURPOSE = PURPOSE.demo;
/** The second pilot code on one account. */
export const PILOT_ALREADY_USED = "PILOT_ALREADY_USED";

/** An account id no row has: a sign-up has no account yet, its try is read against the code only. */
const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000";

/** The purpose of a code, read without case, spaces or hyphens as the package reads it; `null` when no coupon has it. */
async function purposeOf(run: Query, code: string): Promise<string | null> {
  const [row] = await run<{ purpose: string }>("SELECT purpose FROM coupons.coupon WHERE code_key = $1", [
    normalizeCode(code),
  ]);
  return row?.purpose ?? null;
}

/** A pilot the account holds: a use that was neither released nor revoked. */
async function holdsPilot(run: Query, accountId: string): Promise<boolean> {
  const [row] = await run<{ held: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM coupons.redemption r JOIN coupons.coupon c ON c.id = r.coupon_id
       WHERE r.account_id = $1 AND c.purpose = $2 AND r.status IN ('reserved', 'confirmed')) AS held`,
    [accountId, PILOT_PURPOSE],
  );
  return row?.held ?? false;
}

/**
 * Sign-up's first look at the typed code, before any account exists: read-only, the same refusals as a redemption (and one attempt on the limits). A code that is not a pilot
 * is answered « unknown »: the field says nothing about the other codes.
 */
export async function checkPilotCode(code: string, ip: string | null): Promise<void> {
  const result = await guarded(() =>
    coupons.validate(query, code, { mode: "redeem", accountId: NO_ACCOUNT, hasPaidBefore: false, ip }),
  );
  if (!result.ok) {
    throw refuse(
      COUPON_STATUS_CODE[result.code],
      result.code,
      "This code cannot be used",
      result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
  if (result.coupon.kind !== KIND.credit || (await purposeOf(query, code)) !== PILOT_PURPOSE) {
    throw refuse(COUPON_STATUS_CODE[COUPON_CODE.unknown], COUPON_CODE.unknown, "This code cannot be used");
  }
}

export interface RedeemInput {
  code: string;
  accountId: string;
  idempotencyKey: string;
  ip: string | null;
  /** The sign-up field takes pilot codes only. */
  pilotOnly?: boolean;
  headers?: Headers;
  actorLabel?: string;
}

/**
 * Redeems a credit code for an account, in one transaction. A pilot code first takes the account's row lock, so two pilot codes redeemed at once on one account are
 * serialised: the second finds the first and is refused with `PILOT_ALREADY_USED` (409), and the refusal has its audit line.
 */
export async function redeemCreditCode(input: RedeemInput): Promise<CreditRedemption> {
  try {
    const redeemed = await guarded(() =>
      transaction(async (tx) => {
        const purpose = await purposeOf(tx, input.code);
        if (input.pilotOnly && purpose !== PILOT_PURPOSE) {
          throw refuse(COUPON_STATUS_CODE[COUPON_CODE.unknown], COUPON_CODE.unknown, "This code cannot be used");
        }
        if (purpose === PILOT_PURPOSE) {
          await tx("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [input.accountId]);
          if (await holdsPilot(tx, input.accountId)) {
            throw refuse(409, PILOT_ALREADY_USED, "This account has already used a pilot code");
          }
        }
        return coupons.redeemCredit(tx, {
          code: input.code,
          accountId: input.accountId,
          idempotencyKey: input.idempotencyKey,
          ip: input.ip,
          hasPaidBefore: await hasPaidBefore(tx, input.accountId),
        });
      }),
    );
    return redeemed;
  } catch (error) {
    if (error instanceof HttpError && error.body.code === PILOT_ALREADY_USED) {
      await audit({
        action: "billing.pilot_refused",
        actorId: input.accountId,
        actorLabel: input.actorLabel ?? "account",
        detail: { reason: PILOT_ALREADY_USED },
        ...(input.headers ? { headers: input.headers } : {}),
      });
    }
    throw error;
  }
}
