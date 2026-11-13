import { createHmac } from "node:crypto";

import { memorySuppression } from "@krizaka/email";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A bad, an expired and a replayed signature, each refused at the route with its status AND code (krizaka-internal#2385):
 * the payments webhook, the mail webhook and the owner report link. (The tampered signed report is `verify-route.test.ts`;
 * the 15-minute ceiling of storage links is `storage/krizaka-storage.test.ts`; the DB-level dedupe is `billing.integration.test.ts`.)
 */
const state = vi.hoisted(() => ({
  seen: new Set<string>(),
  suppression: null as null | ReturnType<typeof import("@krizaka/email").memorySuppression>,
  share: null as unknown,
}));
const SECRET = "whsec_test_only_not_a_real_secret";
const MAIL_KEY = "webhook-signing-key-for-tests";

vi.mock("./billing", () => ({
  // The real one applies an event id once, in one transaction, and answers "duplicate" afterwards.
  applyPaymentEvent: async (_tx: unknown, event: { id: string }) => {
    if (state.seen.has(event.id)) {
      return "duplicate";
    }
    state.seen.add(event.id);
    return "applied";
  },
}));
vi.mock("./db", () => ({ transaction: async () => undefined, query: async () => [] }));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));
vi.mock("@/lib/mail/store", () => ({
  pgSuppression: {
    has: (e: string) => state.suppression!.has(e),
    add: (e: string, r: "bounce" | "complaint" | "unsubscribed") => state.suppression!.add(e, r),
  },
}));
vi.mock("./limits", () => ({ limit: async () => undefined }));
vi.mock("./owner-report-shares", () => ({ openShare: async () => state.share }));
vi.mock("./report-signer", () => ({ signingKey: () => ({}) }));
vi.mock("./owner-report-pdf", () => ({
  issueOwnerReportPdf: async () => ({ bytes: new Uint8Array([37, 80, 68, 70]) }),
  ownerPayloadOf: () => ({}),
}));
vi.mock("./settings/display-name", () => ({ currentProductName: async () => "Verikora" }));

import { GET as ownerPdf } from "../app/api/rapport/[token]/pdf/route";
import { POST as mailWebhook } from "../app/api/webhooks/mail/route";
import { POST as paymentsWebhook } from "../app/api/webhooks/payments/route";

const NOW = () => Math.floor(Date.now() / 1000);
const event = JSON.stringify({
  id: "evt_replay_1",
  object: "event",
  type: "customer.created",
  created: NOW(),
  data: { object: { id: "cus_1", object: "customer" } },
});
const stripeSig = (body: string, at: number, secret = SECRET) =>
  `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
const pay = (signature: string, body = event) =>
  paymentsWebhook(
    new Request("https://dev.verikora.test/api/webhooks/payments", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body,
    }),
  );

describe("payments webhook", () => {
  beforeEach(() => {
    state.seen.clear();
    vi.unstubAllEnvs();
    vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
    vi.stubEnv("PAYMENTS_STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
    vi.stubEnv("PAYMENTS_STRIPE_WEBHOOK_SECRET", SECRET);
  });

  it("a bad signature is 400 BAD_NOTIFICATION, and applies nothing", async () => {
    const res = await pay(stripeSig(event, NOW(), "whsec_other"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_NOTIFICATION" });
    expect(res.headers.get("X-Error-Code")).toBe("BAD_NOTIFICATION");
    expect(state.seen.size).toBe(0);
  });

  it("an expired signature is 400 BAD_NOTIFICATION, and applies nothing", async () => {
    const res = await pay(stripeSig(event, NOW() - 3600));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "BAD_NOTIFICATION" });
    expect(state.seen.size).toBe(0);
  });

  it("a replayed delivery inside the window is answered 200 and applies the event once", async () => {
    const first = await pay(stripeSig(event, NOW()));
    expect(await first.json()).toMatchObject({ received: true, outcome: "applied" });
    const again = await pay(stripeSig(event, NOW()));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ received: true, outcome: "duplicate" });
    expect(state.seen.size).toBe(1);
  });

  it("a replay of an old capture (valid signature, stale timestamp) is refused, not applied", async () => {
    const stale = await pay(stripeSig(event, NOW() - 24 * 3600));
    expect(stale.status).toBe(400);
    expect(state.seen.size).toBe(0);
  });
});

describe("mail webhook", () => {
  const signed = (over: { key?: string; at?: number } = {}) => ({
    signature: (() => {
      const timestamp = String(over.at ?? NOW());
      const token = "random-token-123";
      return {
        timestamp,
        token,
        signature: createHmac("sha256", over.key ?? MAIL_KEY)
          .update(timestamp + token)
          .digest("hex"),
      };
    })(),
    "event-data": { event: "complained", recipient: "a@example.test" },
  });
  const post = (body: unknown) =>
    mailWebhook(new Request("http://localhost/api/webhooks/mail", { method: "POST", body: JSON.stringify(body) }));
  beforeEach(() => {
    state.suppression = memorySuppression();
    vi.stubEnv("MAIL_WEBHOOK_SIGNING_KEY", MAIL_KEY);
  });

  it("a bad signature is 401 BAD_SIGNATURE and suppresses nothing", async () => {
    const res = await post(signed({ key: "another-key" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "BAD_SIGNATURE" });
    expect(await state.suppression!.has("a@example.test")).toBe(false);
  });

  it("an expired signature is 401 BAD_SIGNATURE", async () => {
    const res = await post(signed({ at: NOW() - 3600 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "BAD_SIGNATURE" });
    expect(await state.suppression!.has("a@example.test")).toBe(false);
  });

  it("a signature that is missing is 401 BAD_SIGNATURE", async () => {
    const res = await post({ "event-data": { event: "complained", recipient: "a@example.test" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "BAD_SIGNATURE" });
  });

  it("a replay inside the window changes nothing: the address stays suppressed once, and the answer is the same", async () => {
    const body = signed();
    const add = vi.spyOn(state.suppression!, "add");
    const first = await post(body);
    const again = await post(body);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await state.suppression!.has("a@example.test")).toBe(true);
    expect(add.mock.calls.every(([address]) => address === "a@example.test")).toBe(true);
  });
});

describe("owner report link (the signed PDF is delivered by the token alone)", () => {
  const get = (token: string) =>
    ownerPdf(new Request(`https://dev.verikora.test/api/rapport/${token}/pdf`), { params: Promise.resolve({ token }) });

  it("an unknown, expired or revoked token is one 404 NOT_FOUND, and no PDF", async () => {
    state.share = null; // openShare answers null for all three (owner-report-shares.integration.test.ts proves it on the real store)
    for (const token of ["unknown", "expired-one", "revoked-one"]) {
      const res = await get(token);
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).not.toBe("application/pdf");
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("a live link delivers the PDF, never cached", async () => {
    state.share = { reference: "R-1" };
    const res = await get("live");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
