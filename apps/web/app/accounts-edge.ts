import { postgresAccounts } from "@krizaka/auth";
import { hashPassword, verifyPassword } from "@krizaka/auth";

import { query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { fromAuthMail, mailerFor } from "@/lib/mailer";
import { resetLinkMinutes } from "@/lib/password-reset";
import { tokenHash } from "@/lib/session";

/** The account service of this deployment (the edge wires the adapter: its data store, the mailer, the password hashing). */
export const accountService = (options: { passwordResetTtlMinutes?: number } = {}) => {
  const e = env();
  return postgresAccounts({ query: async (sql, params) => query(sql, params) as never, transaction: (work) => transaction((run) => work(run as never)), passwordResetTtlMinutes: options.passwordResetTtlMinutes, mail: (mail) => mailerFor(e)(fromAuthMail(mail)), baseUrl: e.APP_PUBLIC_URL, product: "Yomizaka", tokenPrefix: "ye", tokenHash: (token) => tokenHash(token), passwords: { hash: hashPassword, verify: verifyPassword } });
};

/** Whether e-mails can be sent (no key, no e-mail change: it fails closed, like sign-up). */
export const mailConfigured = () => {
  const e = env();
  return e.MAIL_PROVIDER === "mailgun" && !!e.MAIL_API_KEY && !!e.MAIL_DOMAIN;
};

/** The account service for the forgot-password flow: the link lives as long as the `auth.passwordResetMinutes` setting says. */
export const resetAccountService = async () => accountService({ passwordResetTtlMinutes: await resetLinkMinutes() });
