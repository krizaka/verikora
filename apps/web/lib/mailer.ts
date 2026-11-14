import crypto from "node:crypto";

import type { Mail as AccountsMail } from "@krizaka/auth";
import { consoleLog, type IdempotencyStore, type MailEnv, sendEmail, type SuppressionList } from "@krizaka/email";

import { BRAND_ID, PRODUCT_NAME } from "@/lib/brand";
import { currentProductName } from "@/lib/settings/display-name";

import { pgIdempotency, pgSuppression } from "./mail/store";

/**
 * Verikora's e-mail (verikora#48): every message is a template of `@krizaka/email` in Verikora's brand (never hand-written HTML), sent
 * through the `MAIL_*` provider, once per link, never to an address the provider reported, with a delivery log that holds a hash of
 * the recipient and never the address.
 */
export interface MailConfig {
  MAIL_PROVIDER?: string;
  MAIL_API_KEY?: string;
  MAIL_DOMAIN?: string;
  MAIL_API_URL: string;
  MAIL_FROM?: string;
}

/** The links Verikora mails: confirm an address, reset a password, confirm a changed address, and the owner-report link a manager sends (link, expiry and the manager's note only; never report content). */
export type AccountMail =
  | { kind: "confirmEmail"; to: string; locale: "en" | "fr"; url: string; hours: number }
  | { kind: "passwordReset"; to: string; locale: "en" | "fr"; url: string; minutes: number }
  | { kind: "emailChange"; to: string; locale: "en" | "fr"; url: string; hours: number }
  /** The administration's invitation to a closed sign-up (krizaka-internal#3230): the link opens the sign-up for this address; `days` is its lifetime. */
  | {
      kind: "signupInvitation";
      to: string;
      locale: "en" | "fr";
      url: string;
      days: number;
      pilot?: { credits: number };
    }
  | {
      kind: "reportLink";
      to: string;
      locale: "en" | "fr";
      url: string;
      senderName: string;
      expiresOn: string;
      message?: string;
    };

export type Mailer = (mail: AccountMail) => Promise<void>;

/** What a link mail of `@krizaka/auth` (a reset, a changed address) is, as Verikora sends it. A mail with no link cannot be sent: it was text only. */
export function fromAuthMail(mail: AccountsMail): AccountMail {
  const { link } = mail;
  if (!link) throw new Error("Mail has no link to send");
  switch (link.kind) {
    case "passwordReset":
      return { kind: "passwordReset", to: mail.to, locale: mail.locale, url: link.url, minutes: link.minutes ?? 30 };
    case "emailChange":
      return { kind: "emailChange", to: mail.to, locale: mail.locale, url: link.url, hours: link.hours ?? 24 };
    default:
      throw new Error("Mail has a link this app does not send");
  }
}

/** The `MAIL_*` settings as the package reads them; the sender defaults to `<name> <no-reply@<domain>>`. */
export const mailEnvOf = (e: MailConfig, name = PRODUCT_NAME): MailEnv => ({
  MAIL_PROVIDER: e.MAIL_PROVIDER,
  MAIL_API_KEY: e.MAIL_API_KEY,
  MAIL_DOMAIN: e.MAIL_DOMAIN,
  MAIL_API_URL: e.MAIL_API_URL,
  MAIL_FROM: e.MAIL_FROM ?? (e.MAIL_DOMAIN ? `${name} <no-reply@${e.MAIL_DOMAIN}>` : undefined),
});

/** One key per intention: the same link is mailed once (a double click, a retry), a new link is a new intention. */
export const intentionOf = (mail: AccountMail): string =>
  mail.kind +
  ":" +
  crypto
    .createHash("sha256")
    .update(mail.to.toLowerCase() + "\n" + mail.url)
    .digest("hex")
    .slice(0, 32);

type Options = Parameters<typeof sendEmail>[2];

/** The pilot line of an invitation, in the invitee's language (the template takes a ready sentence, 120 characters at most). */
const ALLOWANCE: Record<"en" | "fr", (credits: number) => string> = {
  en: (credits) => `${credits} files included while we are in pilot`,
  fr: (credits) => `${credits} fichiers inclus pendant le pilote`,
};

/** The template of a link, in Verikora's brand. */
function send(mail: AccountMail, options: Options) {
  const brand = BRAND_ID;
  switch (mail.kind) {
    case "confirmEmail":
      return sendEmail("confirmEmail", { brand, confirmUrl: mail.url, hours: mail.hours }, options);
    case "passwordReset":
      return sendEmail("passwordReset", { brand, resetUrl: mail.url, minutes: mail.minutes }, options);
    case "emailChange":
      return sendEmail("emailChange", { brand, confirmUrl: mail.url, hours: mail.hours }, options);
    case "signupInvitation":
      return sendEmail(
        "signupInvitation",
        {
          brand,
          inviteUrl: mail.url,
          days: mail.days,
          ...(mail.pilot ? { allowance: ALLOWANCE[mail.locale](mail.pilot.credits) } : {}),
        },
        options,
      );
    case "reportLink":
      return sendEmail(
        "shareLink",
        {
          brand,
          senderName: mail.senderName,
          shareUrl: mail.url,
          expiresOn: mail.expiresOn,
          ...(mail.message ? { message: mail.message } : {}),
        },
        options,
      );
  }
}

export interface MailerDeps {
  fetch?: typeof fetch;
  log?: Parameters<typeof sendEmail>[2]["log"];
  suppression?: SuppressionList;
  idempotency?: IdempotencyStore;
  now?: () => Date;
}

/**
 * The mailer of this deployment. A delivery that fails throws — sign-up must not pretend a mail left; an address on the suppression
 * list, or a link already mailed, is not an error: nothing is sent and the answer is the same (no disclosure).
 */
export const mailerFor =
  (e: MailConfig, deps: MailerDeps = {}): Mailer =>
  async (mail) => {
    const options = {
      to: mail.to,
      locale: mail.locale,
      env: mailEnvOf(e, await currentProductName()),
      idempotencyKey: intentionOf(mail),
      log: deps.log ?? consoleLog(),
      suppression: deps.suppression ?? pgSuppression,
      idempotency: deps.idempotency ?? pgIdempotency,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    };
    const result = await send(mail, options);
    // sent, or not sent on purpose (suppressed, already mailed): the same answer
    if ("error" in result) throw new Error("Mail provider failed: " + result.error);
  };
