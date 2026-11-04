import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDictionary } from "./i18n";
import { PRIVACY_OFFICER_EMAIL } from "./site";

const ROOT = join(__dirname, "..");

describe("the privacy officer (Loi 25, art. 3.1; krizaka-internal#2365)", () => {
  it("is the company's role mailbox, not contact@", () => {
    expect(PRIVACY_OFFICER_EMAIL).toBe("confidentialite@krizaka.com");
  });

  it.each([
    ["fr", "Responsable de la protection des renseignements personnels"],
    ["en", "Privacy officer"],
  ] as const)("names the title and the address in %s, and no person", (locale, label) => {
    const p = getDictionary(locale).privacy;
    expect(p.officer.label).toBe(label);
    expect(p.officer.title).toBe(
      "Président, Technologies Krizaka Inc.".replace("Président", locale === "fr" ? "Président" : "President"),
    );
    const all = JSON.stringify(p);
    expect(all).not.toMatch(/Oussama|Abid|À COMPLÉTER|TO BE COMPLETED|contact@/i);
  });

  it("the privacy page renders the title and the address", () => {
    const page = readFileSync(join(ROOT, "app/[locale]/privacy/page.tsx"), "utf8");
    expect(page).toContain("PRIVACY_OFFICER_EMAIL");
    expect(page).toContain("t.privacy.officer.title");
  });
});
