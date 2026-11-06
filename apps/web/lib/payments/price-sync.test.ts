import { readFileSync } from "node:fs";

import type { StripeCall } from "@krizaka/payments";
import { describe, expect, it } from "vitest";

import { PRICE } from "../pricing";
import { LiveRefused, PORTAL, PROCESSOR_PLANS, processorCatalogue, syncProcessorPrices } from "./price-sync";

const ENTRIES = [
  { key: PRICE.document, amountCents: 999, currency: "CAD" },
  { key: PRICE.agency, amountCents: 4900, currency: "CAD" },
  { key: PRICE.firm, amountCents: 14900, currency: "CAD" },
  { key: PRICE.api, amountCents: null, currency: "CAD" },
];

describe("the processor follows the catalogue (verikora#548)", () => {
  it("builds the sold plans from the entries in force: integer cents, monthly for subscriptions, nothing for an entry on quote", () => {
    const { plans } = processorCatalogue(ENTRIES);
    expect(plans.map((p) => [p.lookupKey, p.amount, p.currency, p.interval])).toEqual([
      ["verikora_dossier_grid_cad", 999, "cad", undefined],
      ["verikora_agency_monthly_pilot_cad", 4900, "cad", "month"],
      ["verikora_firm_monthly_pilot_cad", 14900, "cad", "month"],
    ]);
    expect(
      processorCatalogue(ENTRIES.map((e) => (e.key === PRICE.firm ? { ...e, amountCents: null } : e))).plans,
    ).toHaveLength(2);
  });

  it("names, tax codes and portal are those of deploy/payments-catalogue.json (one source for the setup command and the sync)", () => {
    const file = JSON.parse(
      readFileSync(new URL("../../../../deploy/payments-catalogue.json", import.meta.url), "utf8"),
    ) as { plans: { lookupKey: string; name: string; taxCode: string }[]; portal: unknown };
    const built = processorCatalogue(ENTRIES).plans;
    expect(file.plans.map((p) => [p.lookupKey, p.name, p.taxCode])).toEqual(
      built.map((p) => [p.lookupKey, p.name, p.taxCode]),
    );
    expect(file.portal).toEqual(PORTAL);
    expect(Object.keys(PROCESSOR_PLANS)).toHaveLength(file.plans.length);
  });

  it("refuses a live key before writing anything", async () => {
    const calls: string[] = [];
    const call: StripeCall = async (method, path) => {
      calls.push(`${method} ${path}`);
      return {};
    };
    await expect(syncProcessorPrices({ call, mode: "live" }, ENTRIES)).rejects.toBeInstanceOf(LiveRefused);
    expect(calls).toEqual([]);
  });

  it("in test mode a changed amount gives a new processor price and an equal one is left alone", async () => {
    const posts: string[] = [];
    const existing: Record<string, number> = {
      verikora_dossier_grid_cad: 999,
      verikora_agency_monthly_pilot_cad: 4900,
      verikora_firm_monthly_pilot_cad: 14900,
    };
    const call: StripeCall = async (method, path, params) => {
      if (method === "POST") posts.push(path);
      if (path === "/v1/prices" && method === "GET") {
        const key = (params?.lookup_keys as string[])[0] ?? "";
        return {
          data:
            existing[key] === undefined
              ? []
              : [{ id: `price_${key}`, unit_amount: existing[key], currency: "cad", product: `prod_${key}` }],
        };
      }
      if (path === "/v1/billing_portal/configurations" && method === "GET")
        return { data: [{ active: true, metadata: { product: "verikora" } }] };
      return { id: "x", data: [] };
    };
    const same = await syncProcessorPrices({ call, mode: "test" }, ENTRIES);
    expect(same.prices.map((p) => p.status)).toEqual(["exists", "exists", "exists"]);
    expect(posts).toEqual([]);
    const changed = await syncProcessorPrices(
      { call, mode: "test" },
      ENTRIES.map((e) => (e.key === PRICE.agency ? { ...e, amountCents: 5900 } : e)),
    );
    expect(changed.prices.find((p) => p.lookupKey === "verikora_agency_monthly_pilot_cad")?.status).toBe("repriced");
    expect(posts).toEqual(["/v1/prices"]);
  });
});
