import { memoryPriceStore, priceCatalogue, publicCatalogue } from "@krizaka/settings";
import { describe, expect, it } from "vitest";

import { PRICE, PRICES } from "../pricing";
import { paywallFigures } from "./paywall";

const NOW = new Date("2026-10-25T12:00:00Z");

describe("the paywall says the catalogue's price of one file, and no subscription price (founder, 2026-11-12)", () => {
  it("in French and English, from the entries in force", async () => {
    const prices = publicCatalogue(await priceCatalogue(PRICES, memoryPriceStore()).catalogue(NOW));
    const fr = paywallFigures(prices, "fr")!;
    expect({ document: fr.document.replace(/\s/gu, " ") }).toEqual({ document: "9,99 $" });
    expect(paywallFigures(prices, "en")).toEqual({ document: "$9.99" });
  });

  it("says nothing it does not have (an entry withdrawn from sale)", () => {
    expect(paywallFigures([{ key: PRICE.agency, amountCents: 65, limits: {} }], "fr")).toBeNull();
  });
});
