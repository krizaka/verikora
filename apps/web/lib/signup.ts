import crypto from "node:crypto";

import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@krizaka/auth";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { Mailer } from "./mailer";
import { tokenHash } from "./session";

/**
 * Self-serve sign-up, for Yomizaka only (decision 2026-10-21). An account is created unverified; a mailed link (random
 * token, kept as a keyed hash, 24 h, single use) verifies the address; only then can the person sign in. The terms and the
 * privacy notice must be accepted (version and date kept). The answer never tells whether an address already has an
 * account (no enumeration).
 */
// @fixed: the lifetime of a verification link, a security parameter
export const VERIFY_TTL_HOURS = 24;
/** The version of the terms and privacy notice the person accepted: change it when either text changes. */
export const TERMS_VERSION = "2026-10-27-draft";

export const signUpBody = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  locale: z.enum(["en", "fr"]).default("fr"),
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
});
export type SignUpInput = z.infer<typeof signUpBody>;

export interface SignUpDeps {
  query: <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
  mail: Mailer;
  baseUrl: string;
  token?: () => string;
}

export const newVerifyToken = () => `yv1.${crypto.randomBytes(32).toString("base64url")}`;
const VERIFY_TOKEN = /^yv1\.[A-Za-z0-9_-]{43}$/;
export const isVerifyToken = (v: string | undefined | null): v is string => !!v && VERIFY_TOKEN.test(v);

/** Creates the account (or re-sends the link of an unverified one) and mails the link. Always resolves the same way. */
export async function signUp(deps: SignUpDeps, input: SignUpInput, now: Date): Promise<{ accountId: string | null }> {
  const [existing] = await deps.query<{ id: string; email_verified_at: Date | null }>("SELECT id, email_verified_at FROM accounts WHERE email = $1", [input.email]);
  if (existing?.email_verified_at) return { accountId: null }; // a real account: say nothing, send nothing
  let id = existing?.id;
  if (!id) {
    const [row] = await deps.query<{ id: string }>(
      "INSERT INTO accounts (email, locale, password_hash, terms_version, terms_accepted_at, privacy_accepted_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id",
      [input.email, input.locale, await hashPassword(input.password), TERMS_VERSION, now],
    );
    id = row!.id;
  }
  const token = (deps.token ?? newVerifyToken)();
  await deps.query("INSERT INTO email_verifications (account_id, token_hash, expires_at) VALUES ($1, $2, $3::timestamptz + make_interval(hours => $4))", [id, tokenHash(token), now, VERIFY_TTL_HOURS]);
  const url = `${deps.baseUrl.replace(/\/$/, "")}/${input.locale}/verify-email?token=${encodeURIComponent(token)}`;
  await deps.mail({ kind: "confirmEmail", to: input.email, locale: input.locale, url, hours: VERIFY_TTL_HOURS });
  return { accountId: id };
}

/** Confirms an address from its link: single use, not expired. */
export async function verifyEmail(deps: Pick<SignUpDeps, "query">, token: string, now: Date): Promise<"VERIFIED" | "INVALID"> {
  if (!isVerifyToken(token)) return "INVALID";
  const [row] = await deps.query<{ id: string; account_id: string }>(
    "UPDATE email_verifications SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING id, account_id",
    [tokenHash(token), now],
  );
  if (!row) return "INVALID";
  await deps.query("UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1", [row.account_id, now]);
  return "VERIFIED";
}
