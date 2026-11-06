import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ applied: [] as unknown[] }));
const SECRET = "whsec_test_only_not_a_real_secret";

vi.mock("./billing", () => ({
  applyPaymentEvent: async (_tx: unknown, event: unknown) => {
    state.applied.push(event);
    return "applied";
  },
}));
vi.mock("./db", () => ({ transaction: async () => undefined, query: async () => [] }));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));

import { POST } from "../app/api/webhooks/payments/route";

const NOW = Math.floor(Date.now() / 1000);
const payload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "customer.created",
  created: NOW,
  data: { object: { id: "cus_test_1", object: "customer" } },
});
const sign = (body: string, at: number, secret = SECRET) =>
  `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
const call = (signature: string | null, body = payload) =>
  POST(
    new Request("https://dev.verikora.test/api/webhooks/payments", {
      method: "POST",
      headers: signature === null ? {} : { "stripe-signature": signature },
      body,
    }),
  );

describe("the payment notification is refused unless its signature is good", () => {
  beforeEach(() => {
    state.applied = [];
    vi.unstubAllEnvs();
    vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
    vi.stubEnv("PAYMENTS_STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
    vi.stubEnv("PAYMENTS_STRIPE_WEBHOOK_SECRET", SECRET);
  });

  it("refuses a missing signature", async () => {
    expect((await call(null)).status).toBe(400);
    expect(state.applied).toEqual([]);
  });

  it("refuses a signature made with another secret", async () => {
    expect((await call(sign(payload, NOW, "whsec_other"))).status).toBe(400);
    expect(state.applied).toEqual([]);
  });

  it("refuses a body changed after it was signed", async () => {
    const signature = sign(payload, NOW);
    expect((await call(signature, payload.replace("cus_test_1", "cus_test_2"))).status).toBe(400);
    expect(state.applied).toEqual([]);
  });

  it("refuses an expired signature (a replay of an old capture)", async () => {
    expect((await call(sign(payload, NOW - 3600))).status).toBe(400);
    expect(state.applied).toEqual([]);
  });

  it("answers 503 and reads nothing while payments are off", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", undefined);
    expect((await call(sign(payload, NOW))).status).toBe(503);
    expect(state.applied).toEqual([]);
  });

  it("accepts a fresh, well-signed notification", async () => {
    expect((await call(sign(payload, NOW))).status).toBe(200);
    expect(state.applied).toHaveLength(1);
  });
});
