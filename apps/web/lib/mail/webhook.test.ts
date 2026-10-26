import { createHmac } from "node:crypto";

import { memorySuppression } from "@krizaka/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const suppression = vi.hoisted(() => ({ list: null as null | { has(email: string): boolean | Promise<boolean>; add(email: string, reason: "bounce" | "complaint" | "unsubscribed"): void | Promise<void> } }));
vi.mock("@/lib/mail/store", () => ({ pgSuppression: { has: (email: string) => suppression.list!.has(email), add: (email: string, reason: "bounce" | "complaint" | "unsubscribed") => suppression.list!.add(email, reason) } }));

import { POST } from "@/app/api/webhooks/mail/route";

/** The mail provider's bounce and complaint webhook (yomizaka#48): signed by the vendor, feeds the suppression list. */
const KEY = "webhook-signing-key-for-tests";
const NAME = "MAIL_WEBHOOK_SIGNING_KEY";
const saved = process.env[NAME];
const signed = (event: Record<string, unknown>, over: { key?: string; at?: number } = {}) => {
  const timestamp = String(over.at ?? Math.floor(Date.now() / 1000));
  const token = "random-token-123";
  const signature = createHmac("sha256", over.key ?? KEY).update(timestamp + token).digest("hex");
  return { signature: { timestamp, token, signature }, "event-data": event };
};
const post = (body: unknown) => POST(new Request("http://localhost/api/webhooks/mail", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  suppression.list = memorySuppression();
  process.env[NAME] = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env[NAME];
  else process.env[NAME] = saved;
});

describe("the mail webhook", () => {
  it("puts a permanently bounced address on the suppression list, so it is never mailed again", async () => {
    const res = await post(signed({ event: "failed", severity: "permanent", recipient: "Gone@Example.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, action: "suppressed" });
    expect(await suppression.list!.has("gone@example.test")).toBe(true);
  });

  it.each([
    [{ event: "complained", recipient: "a@example.test" }, "complaint"],
    [{ event: "unsubscribed", recipient: "b@example.test" }, "unsubscribed"],
  ])("suppresses a %j", async (event, reason) => {
    const add = vi.spyOn(suppression.list!, "add");
    expect((await post(signed(event))).status).toBe(200);
    expect(add).toHaveBeenCalledWith(event.recipient, reason);
  });

  it("ignores what is no reason to stop: a soft failure, a delivery", async () => {
    expect(await (await post(signed({ event: "failed", severity: "temporary", recipient: "soft@example.test" }))).json()).toMatchObject({ action: "ignored" });
    expect(await (await post(signed({ event: "delivered", recipient: "ok@example.test" }))).json()).toMatchObject({ action: "ignored" });
    expect(await suppression.list!.has("soft@example.test")).toBe(false);
  });

  it("refuses a signature that is wrong, from another key or too old: 401, nothing suppressed", async () => {
    for (const body of [signed({ event: "complained", recipient: "x@example.test" }, { key: "another-key" }), signed({ event: "complained", recipient: "x@example.test" }, { at: 1_000_000 })]) expect((await post(body)).status).toBe(401);
    expect((await post({ "event-data": { event: "complained", recipient: "x@example.test" } })).status).toBe(401);
    expect(await suppression.list!.has("x@example.test")).toBe(false);
  });

  it("answers 406 to a signed body that is no event of ours, so the vendor stops sending it", async () => {
    expect((await post(signed({ nothing: true }))).status).toBe(406);
    expect((await post("not json")).status).toBe(401);
  });

  it("answers 404 while no signing key is set: nothing to check a signature with", async () => {
    delete process.env[NAME];
    expect((await post(signed({ event: "complained", recipient: "x@example.test" }))).status).toBe(404);
  });
});
