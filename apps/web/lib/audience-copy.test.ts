import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/** The public copy speaks first to property managers and landlords; tenants stay welcome; the registries are « in preparation » (verikora#359). */
const COPIES = [
  {
    name: "fr",
    m: fr,
    managers: /gestionnaires d['’]immeubles/i,
    tenants: /locataires/i,
    preparing: /en préparation/i,
  },
  {
    name: "en",
    m: en,
    managers: /property managers/i,
    tenants: /tenants/i,
    preparing: /in preparation/i,
  },
];

describe.each(COPIES)("the $name home copy", ({ m, managers, tenants, preparing }) => {
  it("addresses property managers and landlords first in « who » and in the lead, then welcomes tenants", () => {
    const who = m.landing.what.who;
    expect(who).toMatch(managers);
    expect(who).toMatch(tenants);
    expect(who.search(managers)).toBeLessThan(who.search(tenants));
    expect(m.meta.description).toMatch(managers);
    expect(m.landing.lead).toMatch(managers);
  });

  it("speaks of the manager's week in the closing call and of the month in the paid row, not of a single document", () => {
    expect(m.landing.closing.title).toMatch(/semaine|week/i);
    expect(m.pricing.plans.agency.features[0]).toMatch(/mois|month/i);
  });

  it("names the registries only as « in preparation », and the soon list stays without a price", () => {
    const registries = /SOQUIJ|TAL|plumitif/;
    for (const line of [m.landing.what.who, m.landing.lead]) {
      if (registries.test(line)) expect(line).toMatch(preparing);
    }
    for (const item of Object.values(m.pricing.soon.items))
      expect(`${item.name} ${item.text}`).not.toMatch(/\d\s?\$|\$\s?\d/);
  });
});
