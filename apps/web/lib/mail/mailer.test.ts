import { memoryIdempotency, memoryLog, memorySuppression } from "@krizaka/email";
import { describe, expect, it } from "vitest";

import { type AccountMail, fromAuthMail, intentionOf, type MailConfig, mailEnvOf, mailerFor } from "../mailer";

/** Yomizaka's mail (yomizaka#48): templates of @krizaka/email in Yomizaka's brand, through the MAIL_* provider, once per link, never to a reported address. */
const CONFIG: MailConfig = { MAIL_PROVIDER: "mailgun", MAIL_API_KEY: "test-key", MAIL_DOMAIN: "mg.example.test", MAIL_API_URL: "https://api.mail.example.test" };
const confirm: AccountMail = { kind: "confirmEmail", to: "Eric@Example.test", locale: "fr", url: "https://www.yomizaka.com/fr/verify-email?token=yv1.abc", hours: 24 };
const reset: AccountMail = { kind: "passwordReset", to: "eric@example.test", locale: "en", url: "https://www.yomizaka.com/en/reset-password?token=ye1.abc", minutes: 45 };
const change: AccountMail = { kind: "emailChange", to: "new@example.test", locale: "fr", url: "https://www.yomizaka.com/fr/confirm-email?token=ye1.def", hours: 24 };

function provider(status = 200) {
  const sent: { url: string; form: URLSearchParams }[] = [];
  const fetcher = (async (url: string, init: { body: unknown }) => {
    sent.push({ url, form: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify({ id: "<id@mg>" }), { status });
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}
const world = (status = 200) => {
  const { sent, fetcher } = provider(status);
  const log = memoryLog();
  const suppression = memorySuppression();
  const idempotency = memoryIdempotency();
  return { sent, log, suppression, idempotency, mail: mailerFor(CONFIG, { fetch: fetcher, log, suppression, idempotency }) };
};

describe("the sender", () => {
  it("defaults to Yomizaka at the sending domain, and keeps the one the deployment sets", () => {
    expect(mailEnvOf(CONFIG).MAIL_FROM).toBe("Yomizaka <no-reply@mg.example.test>");
    expect(mailEnvOf({ ...CONFIG, MAIL_FROM: "Yomizaka <bonjour@yomizaka.com>" }).MAIL_FROM).toBe("Yomizaka <bonjour@yomizaka.com>");
    expect(mailEnvOf({ MAIL_API_URL: "https://x.test" }).MAIL_FROM).toBeUndefined();
  });
});

describe("sending the three links", () => {
  it.each([
    [confirm, /Confirmez votre adresse Yomizaka/, "verify-email?token=yv1.abc"],
    [reset, /Reset your Yomizaka password/, "reset-password?token=ye1.abc"],
    [change, /Confirmez votre nouvelle adresse Yomizaka/, "confirm-email?token=ye1.def"],
  ])("%#: a branded e-mail with its link, to the address, from Yomizaka", async (mail, subject, link) => {
    const { sent, mail: send } = world();
    await send(mail);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.mail.example.test/v3/mg.example.test/messages");
    const form = sent[0]!.form;
    expect(form.get("to")).toBe(mail.to.toLowerCase());
    expect(form.get("from")).toBe("Yomizaka <no-reply@mg.example.test>");
    expect(form.get("subject")).toMatch(subject);
    expect(form.get("text")).toContain(link);
    expect(form.get("html")).toContain(link.replace("&", "&amp;"));
    // House of Brands: it wears Yomizaka and names no other product.
    expect((form.get("html") ?? "") + (form.get("text") ?? "")).not.toMatch(/Orazaka|Orochia|Akinaza|Kachizaka|Yororis/);
  });

  it("mails one link once: the same link again sends nothing, a new link is a new intention", async () => {
    const { sent, mail } = world();
    await mail(confirm);
    await mail(confirm);
    expect(sent).toHaveLength(1);
    await mail({ ...confirm, url: `${confirm.url}2` });
    expect(sent).toHaveLength(2);
    expect(intentionOf(confirm)).toBe(intentionOf({ ...confirm, to: "eric@example.test" }));
    expect(intentionOf(confirm)).not.toBe(intentionOf(reset));
  });

  it("never mails an address the provider reported, and says nothing of it (no disclosure)", async () => {
    const { sent, suppression, mail } = world();
    await suppression.add("eric@example.test", "bounce");
    await expect(mail(confirm)).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("throws when the provider fails — sign-up must not pretend a mail left — and lets the link be mailed again", async () => {
    const { sent, idempotency, mail } = world(500);
    await expect(mail(confirm)).rejects.toThrow(/Mail provider failed/);
    expect(await idempotency.claim(intentionOf(confirm))).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("keeps a delivery log that holds a hash of the recipient, never the address", async () => {
    const { log, mail } = world();
    await mail(confirm);
    expect(log.entries).toHaveLength(1);
    expect(JSON.stringify(log.entries)).not.toMatch(/example\.test/);
    expect(log.entries[0]).toMatchObject({ status: "sent", locale: "fr" });
  });

  it("fails closed when the provider is not configured", async () => {
    const mail = mailerFor({ MAIL_API_URL: "https://x.test" }, { fetch: provider().fetcher, log: memoryLog(), suppression: memorySuppression(), idempotency: memoryIdempotency() });
    await expect(mail(confirm)).rejects.toThrow();
  });
});

describe("the links of @krizaka/auth", () => {
  const base = { to: "eric@example.test", locale: "fr" as const, subject: "s", text: "t" };

  it("become the same mails: a reset with its lifetime in minutes, a changed address with its hours", () => {
    expect(fromAuthMail({ ...base, link: { kind: "passwordReset", url: "https://u/r", minutes: 45 } })).toEqual({ kind: "passwordReset", to: base.to, locale: "fr", url: "https://u/r", minutes: 45 });
    expect(fromAuthMail({ ...base, link: { kind: "emailChange", url: "https://u/c", hours: 24 } })).toEqual({ kind: "emailChange", to: base.to, locale: "fr", url: "https://u/c", hours: 24 });
  });

  it("refuse a mail that is only text: there is no hand-written mail left", () => {
    expect(() => fromAuthMail(base)).toThrow("no link");
  });
});
