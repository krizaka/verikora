import { type Audience, offerOf } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { catalogueOf, checkHref, chipsOf, GROUPS, planStrip, visibleItems } from "./check-catalogue";
import { SEED_FLOWS } from "./flows-seed";
import { ROUTE_STATES } from "./route-state";

/** « Vérifier un document », B2 (verikora#333): the catalogue is what the registry runs, nothing more. */
const offerFor = (audience: Audience) =>
  offerOf(SEED_FLOWS.filter((f) => f.definition.audiences.includes(audience)).map((f) => f.definition));
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

describe("the catalogue lists only the rulesets that run, from the registry of flows", () => {
  it("a tenant: the leases of the three jurisdictions, the notice and the état des lieux of Québec, and the file's authenticity", () => {
    expect(ids(catalogueOf(offerFor("tenant")))).toEqual([
      "qc-residential-lease",
      "fr-residential-lease",
      "be-residential-lease",
      "qc-visit-notice",
      "qc-premises-condition",
      "authenticity",
    ]);
  });
  it("a freelancer: the invoice and the service contract of Québec, and the file's authenticity — no lease", () => {
    expect(ids(catalogueOf(offerFor("freelancer")))).toEqual(["qc-invoice", "qc-service-contract", "authenticity"]);
  });
  it("a ruleset the registry does not run is not listed; a dated lease ruleset is the lease; the authenticity needs its Studio", () => {
    const offer = {
      studios: ["compliance-check" as const],
      rulesets: ["qc-residential-lease/2026-10-24", "qc-made-up"],
    };
    expect(ids(catalogueOf(offer))).toEqual(["qc-residential-lease"]);
  });
  it("an item says which jurisdiction it belongs to, and what its action names (lease, invoice, contract; the rest is recognised from the file)", () => {
    const byId = Object.fromEntries(catalogueOf(offerFor("tenant")).map((i) => [i.id, i]));
    expect(byId["fr-residential-lease"]).toMatchObject({ group: "lease", jurisdiction: "FR", kind: "lease" });
    expect(byId["qc-visit-notice"]).toMatchObject({ group: "notice", jurisdiction: "QC", kind: "auto" });
    expect(byId["authenticity"]).toMatchObject({ group: "authenticity", jurisdiction: null, kind: "auto" });
    expect(Object.fromEntries(catalogueOf(offerFor("freelancer")).map((i) => [i.id, i.kind]))).toMatchObject({
      "qc-invoice": "invoice",
      "qc-service-contract": "contract",
    });
  });
});

describe("the chips: a group each, its count; the search narrows both", () => {
  const items = catalogueOf(offerFor("tenant"));
  const label = (i: { id: string }) =>
    ({
      "qc-residential-lease": "Bail de logement du Québec",
      "fr-residential-lease": "Bail d'habitation de France",
      "be-residential-lease": "Bail d'habitation de Wallonie",
      "qc-visit-notice": "Avis de visite",
      "qc-premises-condition": "État des lieux",
      authenticity: "Authenticité du fichier",
    })[i.id] ?? i.id;
  it("« Toutes » and one chip per group the registry has, with its count — in the groups' order", () => {
    const chips = chipsOf(items, "", label);
    expect(chips.map((c) => [c.group, c.count])).toEqual([
      [null, 6],
      ["lease", 3],
      ["notice", 2],
      ["authenticity", 1],
    ]);
  });
  it("the groups are a fixed order the page can rely on", () => {
    expect(GROUPS).toEqual(["lease", "invoice", "contract", "notice", "authenticity"]);
  });
  it("a search narrows the counts (accents and case do not matter); a group with no match stays with 0", () => {
    const chips = chipsOf(items, "etat", label);
    expect(chips.map((c) => [c.group, c.count])).toEqual([
      [null, 1],
      ["lease", 0],
      ["notice", 1],
      ["authenticity", 0],
    ]);
  });
  it("shows the items of the chosen group that match the search, in order", () => {
    expect(ids(visibleItems(items, { group: "lease", q: "" }, label))).toEqual([
      "qc-residential-lease",
      "fr-residential-lease",
      "be-residential-lease",
    ]);
    expect(ids(visibleItems(items, { group: null, q: "wallonie" }, label))).toEqual(["be-residential-lease"]);
    expect(ids(visibleItems(items, { group: "notice", q: "bail" }, label))).toEqual([]);
    expect(visibleItems(items, { group: null, q: "" }, label)).toHaveLength(6);
  });
});

describe("the catalogue is filtered by the account's territory (krizaka-internal#2292)", () => {
  it("a Québec tenant: the Québec lease, authenticity, then the Québec notices — no France, no Wallonie", () => {
    expect(ids(catalogueOf(offerFor("tenant"), "QC"))).toEqual([
      "qc-residential-lease",
      "authenticity",
      "qc-visit-notice",
      "qc-premises-condition",
    ]);
  });
  it("a Québec landlord sees the same four, in the ticket's order", () => {
    expect(ids(catalogueOf(offerFor("landlord"), "QC"))).toEqual([
      "qc-residential-lease",
      "authenticity",
      "qc-visit-notice",
      "qc-premises-condition",
    ]);
  });
  it("a Québec freelancer keeps the Québec invoice and service contract, authenticity first (no lease)", () => {
    expect(ids(catalogueOf(offerFor("freelancer"), "QC"))).toEqual([
      "authenticity",
      "qc-invoice",
      "qc-service-contract",
    ]);
  });
  it("a French account: the French lease and authenticity only", () => {
    expect(ids(catalogueOf(offerFor("tenant"), "FR"))).toEqual(["fr-residential-lease", "authenticity"]);
  });
  it("another territory (ZZ) and no territory list every check, authenticity last", () => {
    const all = [
      "qc-residential-lease",
      "fr-residential-lease",
      "be-residential-lease",
      "qc-visit-notice",
      "qc-premises-condition",
      "authenticity",
    ];
    expect(ids(catalogueOf(offerFor("tenant"), "ZZ"))).toEqual(all);
    expect(ids(catalogueOf(offerFor("tenant"), null))).toEqual(all);
  });
  it("a territory with no check of its own still offers the file's authenticity", () => {
    expect(ids(catalogueOf(offerFor("freelancer"), "FR"))).toEqual(["authenticity"]);
  });
});

describe("the action names the kind in the address and leads to the drop", () => {
  it("uses the app's own `type` key; « auto » leaves the address clean", () => {
    expect(ROUTE_STATES.checkKind.state.key).toBe("type");
    expect(checkHref("fr", "lease")).toBe("/fr/app/check?type=lease#depot");
    expect(checkHref("en", "invoice")).toBe("/en/app/check?type=invoice#depot");
    expect(checkHref("en", "auto")).toBe("/en/app/check#depot");
  });
});

describe("the plan strip: its numbers are the billing state's", () => {
  it("Pro: audits used this month against the fair-use cap, in the meter", () => {
    expect(
      planStrip({ kind: "pro", used: 18, cap: 100, renewsAt: "2026-11-20T00:00:00.000Z", cancelled: false }),
    ).toEqual({ plan: "pro", figures: [], meter: { value: 18, max: 100 } });
  });
  it("credits: the audits left, no meter (there is no ceiling to measure against)", () => {
    expect(planStrip({ kind: "credits", left: 3 })).toEqual({
      plan: "credits",
      figures: [{ id: "left", value: 3 }],
      meter: null,
    });
  });
  it("an account an operator made: included, no number", () => {
    expect(planStrip({ kind: "included" })).toEqual({ plan: "included", figures: [], meter: null });
  });
});
