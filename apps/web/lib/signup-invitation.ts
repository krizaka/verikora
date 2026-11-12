import {
  hashPassword,
  SIGNUP_INVITATION_TTL_DAYS,
  type SignupInvitation,
  SignupInvitationError,
  signupInvitations,
} from "@krizaka/auth";
import type { Query } from "@krizaka/db";
import { z } from "zod";

import { auditIn } from "./audit";
import { PILOT_PURPOSE, redeemCreditCode } from "./coupons/pilot";
import { codeOf, HttpError, refuse } from "./http";
import type { Mailer } from "./mailer";
import { tokenHash } from "./session";
import { signUpBody, TERMS_VERSION } from "./signup";

/**
 * Invitation-only sign-up (krizaka-internal#3230, founder decision 2026-11-12): while `signup.open` is off, the administration invites a property manager by address,
 * optionally with one of its pilot codes. The link (`yi1.<43>`, only its keyed hash is kept, `@krizaka/auth` `signupInvitations`) opens the sign-up form for that address
 * only; redeeming it creates the account with the address verified (the link proved the mailbox) and redeems the pilot, in one transaction. A code never opens sign-up:
 * an invitation does, for one address.
 */
export const INVITE_TOKEN_PREFIX = "yi";
/** The lifetime of an invitation: the package's default (7 days), said in the mail. */
export const INVITE_TTL_DAYS = SIGNUP_INVITATION_TTL_DAYS;
/** The grant an invitation carries: a pilot code, applied once at redemption, set by the admin and never read from the client. */
export const PILOT_GRANT = "coupon";
/** The address already has a confirmed account: the admin is told so; the invitee is sent to sign in. */
export const ACCOUNT_EXISTS = "ACCOUNT_EXISTS";
/** The chosen pilot code is not one of the live, non-exhausted pilot coupons. */
export const PILOT_NOT_AVAILABLE = "PILOT_NOT_AVAILABLE";

const LIST_MAX = 200;

const invitationsOn = (run: Query) =>
  signupInvitations({
    query: run,
    tokenPrefix: INVITE_TOKEN_PREFIX,
    tokenHash: (t) => tokenHash(t),
    ttlDays: INVITE_TTL_DAYS,
  });

/** A refusal of the package, as the API answers it: its status and its stable code. */
function refusalOf(error: unknown): unknown {
  return error instanceof SignupInvitationError
    ? refuse(error.status, error.code, "This invitation cannot be used")
    : error;
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw refusalOf(error);
  }
}

export interface PilotCoupon {
  id: string;
  code: string;
  credits: number;
  validDays: number;
  /** Uses left before the cap, `null` without a cap. */
  usesLeft: number | null;
}

/** The pilot coupons an invitation may carry: credit codes with the purpose « demo », active, in their window, not exhausted (a use not released or given back counts). */
export async function pilotCoupons(run: Query, now: Date): Promise<PilotCoupon[]> {
  const rows = await run<{
    id: string;
    code: string;
    credits: number;
    credits_valid_days: number;
    uses_left: number | null;
  }>(
    `SELECT c.id, c.code, c.credits, c.credits_valid_days,
            c.max_redemptions - (SELECT count(*) FROM coupons.redemption r
              WHERE r.coupon_id = c.id AND r.status <> 'released' AND NOT r.use_restored)::int AS uses_left
       FROM coupons.coupon c
      WHERE c.kind = 'credit' AND c.purpose = $1 AND c.status = 'active' AND c.starts_at <= $2 AND (c.ends_at IS NULL OR c.ends_at > $2)
      ORDER BY c.code LIMIT $3`,
    [PILOT_PURPOSE, now, LIST_MAX],
  );
  return rows
    .filter((r) => r.uses_left === null || r.uses_left > 0)
    .map((r) => ({
      id: r.id,
      code: r.code,
      credits: r.credits,
      validDays: r.credits_valid_days,
      usesLeft: r.uses_left,
    }));
}

export interface Actor {
  id: string;
  label: string;
}

export const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** One of `pilotCoupons` by its id (a select of data, never a typed code). */
  pilotCouponId: z.string().uuid().optional(),
  locale: z.enum(["en", "fr"]),
});
export type InviteInput = z.infer<typeof inviteBody>;

export interface InviteDeps {
  run: <T>(work: (tx: Query) => Promise<T>) => Promise<T>;
  mail: Mailer;
  baseUrl: string;
  headers?: Headers;
}

/** The link the invitation mails: the sign-up page of the invitee's language, the token in the query (a page of ours, `Referrer-Policy` keeps it there). */
export const inviteUrl = (baseUrl: string, locale: "en" | "fr", token: string) =>
  `${baseUrl.replace(/\/$/, "")}/${locale}/sign-up?invite=${encodeURIComponent(token)}`;

async function assertNoAccount(run: Query, email: string): Promise<void> {
  const [row] = await run<{ verified: boolean }>(
    "SELECT email_verified_at IS NOT NULL AS verified FROM accounts WHERE email = $1",
    [email],
  );
  if (row?.verified) {
    throw refuse(409, ACCOUNT_EXISTS, "This address already has an account");
  }
}

async function pilotCodeOf(run: Query, couponId: string | undefined, now: Date): Promise<string | null> {
  if (!couponId) {
    return null;
  }
  const pilot = (await pilotCoupons(run, now)).find((p) => p.id === couponId);
  if (!pilot) {
    throw refuse(422, PILOT_NOT_AVAILABLE, "This pilot code cannot be given");
  }
  return pilot.code;
}

type Sent = { invitation: SignupInvitation; token: string };

/** Mails the link and writes the trail line, inside the invitation's transaction: a mail that fails leaves no invitation. The token is in the mail only. */
async function deliver(tx: Query, deps: InviteDeps, sent: Sent, locale: "en" | "fr", action: string, actor: Actor) {
  await deps.mail({
    kind: "signupInvitation",
    to: sent.invitation.email,
    locale,
    url: inviteUrl(deps.baseUrl, locale, sent.token),
    days: INVITE_TTL_DAYS,
  });
  await auditIn(tx, {
    action,
    actorId: actor.id,
    actorLabel: actor.label,
    targetId: sent.invitation.id,
    detail: { email: sent.invitation.email, pilot: sent.invitation.grant?.ref ?? null, locale },
    ...(deps.headers ? { headers: deps.headers } : {}),
  });
}

/** Invites an address (a new invitation of the same address replaces the open one), with an optional pilot. Refuses an address that has a confirmed account. */
export async function inviteManager(deps: InviteDeps, actor: Actor, input: InviteInput, now: Date) {
  return guarded(() =>
    deps.run(async (tx) => {
      await assertNoAccount(tx, input.email);
      const code = await pilotCodeOf(tx, input.pilotCouponId, now);
      const sent = await invitationsOn(tx).invite(
        { email: input.email, invitedBy: actor.id, grant: code ? { kind: PILOT_GRANT, ref: code } : null },
        now,
      );
      await deliver(tx, deps, sent, input.locale, "auth.invitation_sent", actor);
      return sent.invitation;
    }),
  );
}

/** Sends the invitation again with a new link (the old one opens nothing any more). */
export async function resendInvitation(deps: InviteDeps, actor: Actor, id: string, locale: "en" | "fr", now: Date) {
  return guarded(() =>
    deps.run(async (tx) => {
      const sent = await invitationsOn(tx).resend(id, actor.id, now);
      await deliver(tx, deps, sent, locale, "auth.invitation_resent", actor);
      return sent.invitation;
    }),
  );
}

/** Closes an open invitation: its link opens nothing any more. */
export async function revokeInvitation(
  run: <T>(work: (tx: Query) => Promise<T>) => Promise<T>,
  actor: Actor,
  id: string,
  now: Date,
  headers?: Headers,
) {
  await guarded(() =>
    run(async (tx) => {
      await invitationsOn(tx).revoke(id, actor.id, now);
      await auditIn(tx, {
        action: "auth.invitation_revoked",
        actorId: actor.id,
        actorLabel: actor.label,
        targetId: id,
        ...(headers ? { headers } : {}),
      });
    }),
  );
}

/** The open invitations, oldest first, for the administration's list. */
export const pendingInvitations = (run: Query, now: Date) => invitationsOn(run).pending(now, LIST_MAX);

/** The invited address of a valid link, or `null` for any link that opens nothing (unknown, malformed, expired, used, revoked: the page never says which). */
export async function peekInvitation(
  run: Query,
  token: string,
  now: Date,
): Promise<{ email: string; expiresAt: Date } | null> {
  try {
    return await invitationsOn(run).peek(token, now);
  } catch (error) {
    if (error instanceof SignupInvitationError) {
      return null;
    }
    throw error;
  }
}

/** The sign-up body with an invitation: the same fields, the link's token; a pilot comes from the invitation only. */
export const invitedSignUpBody = signUpBody.omit({ pilotCode: true }).extend({ invite: z.string().min(1).max(200) });
export type InvitedSignUpInput = z.infer<typeof invitedSignUpBody>;

export interface RedeemDeps {
  run: <T>(work: (tx: Query) => Promise<T>) => Promise<T>;
  ip: string | null;
  headers?: Headers;
  idempotencyKey: string;
}

/** Applies the invitation's pilot under a savepoint: a pilot refused (the pot ran out in between, one already held) leaves the account, with its line on the trail. */
async function grantPilot(tx: Query, deps: RedeemDeps, accountId: string, code: string): Promise<boolean> {
  await tx("SAVEPOINT invitation_pilot");
  try {
    await redeemCreditCode({
      code,
      accountId,
      idempotencyKey: deps.idempotencyKey,
      ip: deps.ip,
      pilotOnly: true,
      run: tx,
      ...(deps.headers ? { headers: deps.headers } : {}),
      actorLabel: "invitation",
    });
    await tx("RELEASE SAVEPOINT invitation_pilot");
    return true;
  } catch (error) {
    await tx("ROLLBACK TO SAVEPOINT invitation_pilot");
    await auditIn(tx, {
      action: "billing.pilot_refused",
      actorId: accountId,
      actorLabel: "invitation",
      detail: { at: "invitation", reason: error instanceof HttpError ? codeOf(error, "ERROR") : "ERROR" },
      ...(deps.headers ? { headers: deps.headers } : {}),
    });
    return false;
  }
}

/** The account of the invited address: a new one, or the unconfirmed one an earlier sign-up left (the link proves the mailbox). A confirmed account is refused. */
async function accountFor(tx: Query, email: string, input: InvitedSignUpInput, now: Date): Promise<string> {
  const [existing] = await tx<{ id: string; verified: boolean }>(
    "SELECT id, email_verified_at IS NOT NULL AS verified FROM accounts WHERE email = $1 FOR UPDATE",
    [email],
  );
  if (existing?.verified) {
    throw refuse(409, ACCOUNT_EXISTS, "This address already has an account");
  }
  const values = [email, input.locale, await hashPassword(input.password), TERMS_VERSION, now];
  if (existing) {
    await tx(
      "UPDATE accounts SET locale = $2, password_hash = $3, terms_version = $4, terms_accepted_at = $5, privacy_accepted_at = $5, email_verified_at = $5 WHERE id = $6",
      [...values, existing.id],
    );
    return existing.id;
  }
  const [row] = await tx<{ id: string }>(
    "INSERT INTO accounts (email, locale, password_hash, terms_version, terms_accepted_at, privacy_accepted_at, email_verified_at) VALUES ($1, $2, $3, $4, $5, $5, $5) RETURNING id",
    values,
  );
  return row!.id;
}

/**
 * Sign-up through an invitation, in one transaction: the link is used (for the invited address only), the account is created with that address verified, and the
 * invitation's pilot is redeemed. If anything but the pilot fails, the rollback leaves the link good.
 */
export async function signUpWithInvitation(
  deps: RedeemDeps,
  input: InvitedSignUpInput,
  now: Date,
): Promise<{ accountId: string; pilot: boolean }> {
  return guarded(() =>
    deps.run(async (tx) => {
      const { email, grant, invitedBy } = await invitationsOn(tx).redeem(input.invite, { email: input.email }, now);
      const accountId = await accountFor(tx, email, input, now);
      const pilot = grant?.kind === PILOT_GRANT ? await grantPilot(tx, deps, accountId, grant.ref) : false;
      await auditIn(tx, {
        action: "auth.invitation_redeemed",
        actorId: accountId,
        actorLabel: email,
        detail: { invitedBy, pilot: grant?.ref ?? null, granted: pilot },
        ...(deps.headers ? { headers: deps.headers } : {}),
      });
      return { accountId, pilot };
    }),
  );
}
