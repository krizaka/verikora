import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { TAL } from "../brief/tal";
import { withTalRate } from "../brief/tal-settings";
import { ruleTitle } from "../rule-text";
import { checkSectionG } from "./section-g";
import { sectionGFinding } from "./section-g-finding";

const table = withTalRate(TAL, { year: 2026, basisPoints: 310, sourceUrl: "https://www.quebec.ca/nouvelles/actualites/details/le-calcul-de-lajustement-des-loyers-en-2026-68053", enteredOn: "2026-10-29" });
// the demo cast's lease (content/demo-lease-runs): previous rent 925,00 $, new rent 950,00 $
const run = (newRentCents: number, lang: "en" | "fr" = "en") => sectionGFinding(checkSectionG({ newRentCents, previousRent: { kind: "stated", cents: 92_500 }, year: 2026 }, table), lang, lang === "en" ? en.sectionG : fr.sectionG, ruleTitle("TS-G-001", lang, null));

describe("Section G as a report finding", () => {
  it("fails with the recourse and the articles when the rent is over the rate", () => {
    const f = run(99_000);
    expect(f).toMatchObject({ ruleId: "TS-G-001", verdict: "FAIL", method: "DETERMINISTIC", citation: "C.c.Q., art. 1896 ; C.c.Q., art. 1950" });
    expect(f?.explanation).toContain("1950");
    expect(f?.explanation).toContain("not legal advice");
    expect(f?.title).toBe("Previous rent in Section G and the tribunal's percentage");
  });

  it("passes within the rate, without a recourse", () => {
    const f = run(95_000);
    expect(f).toMatchObject({ verdict: "PASS", citation: "C.c.Q., art. 1896" });
    expect(f?.explanation).not.toContain("Recourse");
  });

  it("is in French too, and says nothing when the rate is not entered", () => {
    expect(run(99_000, "fr")?.explanation).toContain("pas un avis juridique");
    expect(sectionGFinding(checkSectionG({ newRentCents: 99_000, previousRent: { kind: "stated", cents: 92_500 }, year: 2026 }, TAL), "en", en.sectionG, "t")).toBeNull();
  });
});
