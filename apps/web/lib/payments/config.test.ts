import { afterEach, describe, expect, it, vi } from "vitest";

import { paymentsFrom } from "./config";

const ON = {
  PAYMENTS_PROVIDER: "stripe",
  PAYMENTS_STRIPE_SECRET_KEY: "test-api-key",
  PAYMENTS_STRIPE_WEBHOOK_SECRET: "signing-material-for-unit-tests",
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("the payments vendor is chosen here, from configuration", () => {
  it("is off without a provider or keys", () => {
    expect(paymentsFrom({ ...ON, PAYMENTS_PROVIDER: undefined })).toBeNull();
    expect(paymentsFrom({ ...ON, PAYMENTS_STRIPE_SECRET_KEY: undefined })).toBeNull();
    expect(paymentsFrom({ ...ON, PAYMENTS_STRIPE_WEBHOOK_SECRET: undefined })).toBeNull();
  });

  it("a document is a one-off payment and Agencies / Law firms subscriptions, each priced by the catalogue's lookup key", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return String(url).includes("/v1/prices")
        ? json({ data: [{ id: "price_x", unit_amount: 999, currency: "cad", recurring: null }] })
        : json({ url: "https://checkout.example/pay" });
    });
    const port = paymentsFrom(ON)!;
    for (const kind of ["document", "agency", "firm"])
      await port.checkout({
        kind,
        customerId: "cus_1",
        accountId: "a1",
        successUrl: "https://s",
        cancelUrl: "https://c",
        locale: "fr",
      });
    expect(calls[0]!.url).toContain("lookup_keys%5B0%5D=verikora_dossier_grid_cad");
    expect(new URLSearchParams(calls[1]!.body).get("mode")).toBe("payment");
    expect(calls[2]!.url).toContain("lookup_keys%5B0%5D=verikora_agency_monthly_pilot_cad");
    expect(new URLSearchParams(calls[3]!.body).get("mode")).toBe("subscription");
    expect(calls[4]!.url).toContain("lookup_keys%5B0%5D=verikora_firm_monthly_pilot_cad");
    expect(new URLSearchParams(calls[5]!.body).get("mode")).toBe("subscription");
  });

  it("sells no plan the catalogue does not (the old « audit » and « pro » are gone)", async () => {
    await expect(paymentsFrom(ON)!.price("pro")).rejects.toMatchObject({ status: 404 });
  });
});
