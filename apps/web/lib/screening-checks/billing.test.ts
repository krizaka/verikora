import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { SETTINGS } from "../settings/registry";
import { closedBilling, invoiceLine, isChargeable, isRefundable, PAYER, payerAllowed, quoteOf, totalCents } from "./billing";
import { type CheckTypeRow, priceCents } from "./catalogue";

const type = (key: string, cost: number, margin: number, over: Partial<CheckTypeRow> = {}): CheckTypeRow => ({
  key, provider_id: "engine", purpose: "CREDIT", label_fr: key, label_en: key, provider_cost_cents: cost, margin_cents: margin, currency: "CAD", region: "QC",
  consent_notice_version: "v1", enabled: true, default_on: true, requires_lawyer: null, applicant_may_pay: false, note: null, ...over,
});

describe("per-check billing (yomizaka#133) — test fixtures only, flag off", () => {
  it("is OFF by default: nothing is charged until an administrator turns the flag on", () => {
    expect(SETTINGS["features.screeningBilling"].default).toBe(false);
  });
  it("charges cost + margin, both from the row: changing the margin is changing a row", () => {
    expect(priceCents(type("credit", 1200, 700))).toBe(1900);
    expect(priceCents(type("credit", 1200, 500))).toBe(1700);
    const quote = quoteOf([type("a", 1200, 700), type("b", 0, 0)]);
    expect(quote.map((l) => l.cents)).toEqual([1900, 0]);
    expect(totalCents(quote)).toBe(1900);
  });
  it("lets the applicant pay only where every priced check allows it", () => {
    expect(payerAllowed(PAYER.owner, [type("a", 100, 100)])).toBe(true);
    expect(payerAllowed(PAYER.applicant, [type("a", 100, 100)])).toBe(false);
    expect(payerAllowed(PAYER.applicant, [type("a", 100, 100, { applicant_may_pay: true }), type("free", 0, 0)])).toBe(true);
  });
  it("charges a check the provider accepted, never an error, a refusal or « not available yet »", () => {
    expect(isChargeable("answered", 1900)).toBe(true);
    expect(isChargeable("pending", 1900)).toBe(true);
    expect(isChargeable("unavailable", 1900)).toBe(false);
    expect(isChargeable("soon", 1900)).toBe(false);
    expect(isChargeable("answered", 0)).toBe(false);
  });
  it("refunds a charged check that ends without an answer", () => {
    expect(isRefundable("unavailable")).toBe(true);
    expect(isRefundable("answered")).toBe(false);
  });
  it("words the invoice line as a service by Krizaka, in both languages", () => {
    expect(invoiceLine(fr.screening.invoice.line, "Rapport de crédit")).toBe("Vérification : Rapport de crédit — service Krizaka");
    expect(invoiceLine(en.screening.invoice.line, "Credit report")).toBe("Check: Credit report — a Krizaka service");
  });
  it("the closed port refuses, so a flag turned on by mistake bills nothing", async () => {
    await expect(closedBilling.charge({ key: "k", payer: "owner", amountCents: 100, currency: "cad", description: "d", taxCode: "software-as-a-service" })).rejects.toMatchObject({ status: 503 });
  });
});
