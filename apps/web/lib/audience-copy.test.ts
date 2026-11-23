import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/** The public copy speaks first to property managers and landlords; the registries are « in preparation » (verikora#359). */
const COPIES = [
  {
    name: "fr",
    m: fr,
    managers: /gestionnaires d['’]immeubles/i,
    preparing: /en préparation/i,
  },
  {
    name: "en",
    m: en,
    managers: /property managers/i,
    preparing: /in preparation/i,
  },
];

describe.each(COPIES)("the $name home copy", ({ m, managers, preparing }) => {
  it("addresses property managers and landlords first, in the description", () => {
    expect(m.meta.description).toMatch(managers);
  });

  it("speaks of the month in the paid row, not of a single document", () => {
    expect(m.pricing.plans.agency.features[0]).toMatch(/mois|month/i);
  });

  it("names the registries only as « in preparation », and the soon list stays without a price", () => {
    const registries = /SOQUIJ|TAL|plumitif/;
    for (const line of [m.meta.description, ...Object.values(m.productPage.limits.items)]) {
      if (registries.test(line)) expect(line).toMatch(preparing);
    }
    for (const item of Object.values(m.pricing.soon.items))
      expect(`${item.name} ${item.text}`).not.toMatch(/\d\s?\$|\$\s?\d/);
  });
});
