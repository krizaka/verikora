import { describe, expect, it } from "vitest";

import { safeFilename, titleFor, titleOf } from "./documents";
import { normaliseText } from "./pdf-text";

// A real-world case (fictional data): the filename and the text layer of a PDF saved on macOS arrive decomposed (NFD) — the
// accent is a combining mark after its letter — and the typographic apostrophe is U+2019.
const NFD_NAME = "Revenu Québec_Inscription d’une entreprise en démarrage.pdf";

describe("accents and apostrophes survive the filename and the title", () => {
  it("keeps the accent on its letter (NFC) and the apostrophe", () => {
    const name = safeFilename(NFD_NAME);
    expect(name).toBe("Revenu Québec_Inscription d’une entreprise en démarrage.pdf");
    expect(name.normalize("NFC")).toBe(name);
  });
  it("derives a readable title, not « Que bec » and « d une »", () => {
    expect(titleOf(safeFilename(NFD_NAME))).toBe("Revenu Québec Inscription d’une entreprise en démarrage");
  });
  it("still neutralises what is unsafe", () => {
    expect(safeFilename("../../etc/pass<wd>.pdf")).not.toMatch(/[/<>]/);
  });
  it("a straight apostrophe is kept too", () => {
    expect(titleOf(safeFilename("Facture d'avril.pdf"))).toBe("Facture d'avril");
  });
});

describe("extracted text is normalised", () => {
  it("merges combining marks into their letters (NFC)", () => {
    const text = normaliseText("Inscription d’une entreprise en démarrage — Québec, été");
    expect(text).toBe("Inscription d’une entreprise en démarrage — Québec, été");
  });
  it("keeps apostrophes and the letters œ and æ", () => {
    expect(normaliseText("l'œuvre et l’cœur, æther")).toBe("l'œuvre et l’cœur, æther");
  });
  it("turns presentation ligatures (ﬁ ﬂ) into letters so the text can be searched and quoted", () => {
    expect(normaliseText("oﬃce, ﬁnancier, ﬂux")).toBe("office, financier, flux");
  });
  it("drops zero-width characters that split words", () => {
    expect(normaliseText("entre​prise")).toBe("entreprise");
  });
  // A real Stripe invoice (Runway, 2026-11-14) draws its hyphen and thin spaces with glyphs the font maps to U+0000; Postgres
  // refuses a NUL in a text column, so the whole read failed as « UNREADABLE_FILE » (krizaka-internal#4028).
  it("never keeps a NUL: between two letters or digits it was a hyphen, elsewhere a space", () => {
    const text = normaliseText("Invoice number 97R2MDRH\u00000017\nQST - Quebec \u00009.975% on $50.00\u0000 $4.99");
    expect(text).not.toContain("\u0000");
    expect(text).toBe("Invoice number 97R2MDRH-0017\nQST - Quebec 9.975% on $50.00 $4.99");
  });
  it("drops the other control characters but keeps line breaks and tabs as layout", () => {
    expect(normaliseText("a\u0001b\u007f\tc\nd")).toBe("ab c\nd");
  });
});

describe("the title comes from the normalised text when the filename says nothing", () => {
  it("uses the first line of the text for a scan name", () => {
    expect(titleFor("IMG_2041.pdf", "\nReçu d’inscription d’une entreprise en démarrage\nRéférence 123")).toBe(
      "Reçu d’inscription d’une entreprise en démarrage",
    );
    expect(titleFor("scan 3.pdf", "Bail de logement\n…")).toBe("Bail de logement");
  });
  it("keeps a meaningful filename", () => {
    expect(titleFor("Bail Saint-Denis.pdf", "Autre chose")).toBe("Bail Saint Denis");
  });
});
