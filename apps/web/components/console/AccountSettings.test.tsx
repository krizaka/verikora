import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import fr from "@/messages/fr.json";

import { BillingActions, billingRows, type Entitlement } from "./AccountSettings";

const say = (key: string, vars?: Record<string, string | number>) => {
  const words = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fr.console) as string;
  return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), words ?? key);
};
const date = (iso: string) => iso.slice(0, 10);
const FREE: Entitlement = { credits: 0, pro: false, proUntil: null, freeAuditUsed: false, selfServe: true, hasCustomer: false, planKey: null };

describe("billing as flat rows (the review's E3)", () => {
  it("a free self-serve account: the plan, the free audit, the paid audits left — no renewal", () => {
    expect(billingRows(FREE, say, date).map((r) => [r.label, r.value])).toEqual([
      ["Forfait", "Gratuit"],
      ["Audit gratuit", fr.console.settings.billing.freeAvailable],
      ["Audits payés restants", "0"],
    ]);
    expect(billingRows({ ...FREE, freeAuditUsed: true, credits: 3 }, say, date).map((r) => r.value)).toEqual(["Gratuit", fr.console.settings.billing.freeUsed, "3"]);
  });
  it("a subscribed account: its plan, named by the catalogue entry it was sold at, and its renewal; an account that is not self-serve has no free audit row", () => {
    expect(billingRows({ ...FREE, pro: true, planKey: "yomizaka.firm", proUntil: "2026-11-23T00:00:00.000Z", selfServe: false }, say, date)[0]!.value).toBe(fr.console.settings.billing.plans.firm);
    expect(billingRows({ ...FREE, pro: true, proUntil: "2026-11-23T00:00:00.000Z", selfServe: false }, say, date).map((r) => [r.id, r.value])).toEqual([
      ["plan", fr.console.settings.billing.plans.agency],
      ["credits", "0"],
      ["until", "2026-11-23"],
    ]);
  });
});

describe("the billing buttons (extracted from BillingSection, behaviour unchanged)", () => {
  const call = { pending: false, go: () => undefined };
  const html = (e: Entitlement | undefined) => renderToStaticMarkup(createElement(BillingActions, { entitlement: e, buy: call, portal: call, say })).replaceAll("&#x27;", "'");
  it("a free account is offered the three purchases and no portal until it is a customer", () => {
    const out = html(FREE);
    expect(out).toContain(fr.console.paywall.agency);
    expect(out).toContain(fr.console.paywall.firm);
    expect(out).toContain(fr.console.paywall.payOne);
    expect(out).not.toContain(fr.console.settings.billing.portal);
  });
  it("a subscriber with a customer sees only the portal; nothing before the entitlement loads", () => {
    const out = html({ ...FREE, pro: true, hasCustomer: true });
    expect(out).toContain(fr.console.settings.billing.portal);
    expect(out).not.toContain(fr.console.paywall.agency);
    expect(html(undefined)).not.toContain("<button");
  });
});
