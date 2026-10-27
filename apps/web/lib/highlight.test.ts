import { locateQuote } from "@krizaka/ui/document-viewer";
import { describe, expect, it } from "vitest";

import { readText } from "./pdf-text";
import { textLayer, textPdf } from "./test-pdf";

// The lease Yomizaka's demo uses (lib/sample-lease.ts) — Latin-1 only so a plain Helvetica PDF holds it.
const LEASE = [
  "BAIL DE LOGEMENT - 4 1/2, rue Saint-Denis, Montreal",
  "Entre le locateur Monsieur Marc Tremblay, domicilie a Montreal,",
  "et la locataire Madame Sophie Gagnon.",
  "Duree : 12 mois, du 1er juillet 2026 au 30 juin 2027.",
  "Loyer mensuel : 1 450 $, payable le premier jour du mois.",
  "La locataire verse un depot de securite de 1 450 $ a la signature.",
  "La locataire remet douze cheques postdates.",
  "Il est interdit d'avoir des enfants dans le logement.",
];

describe("a finding's quote, from Yomizaka's text to a box on the PDF", () => {
  const pdf = textPdf([...LEASE, ...Array.from({ length: 40 }, (_, i) => `Clause ${i + 1} generique du bail.`), "Fin du bail : le locataire quitte les lieux le 30 juin 2027."], 20);

  it("places the quote Orazaka returns (taken from the text Yomizaka extracted) on the right page, where the line is", async () => {
    const { text, pages } = await readText("application/pdf", pdf);
    expect(pages).toBe(3);
    const quote = "Il est interdit d'avoir des enfants dans le logement.";
    expect(text).toContain(quote);
    const found = locateQuote(await textLayer(pdf), quote)!;
    expect(found).toMatchObject({ page: 1, match: "exact" });
    expect(found.boxes).toHaveLength(1);
    const [box] = found.boxes;
    // line index 7 of page 1: baseline 720 − 7 × 16 = 608 on a 792-high page, 72 pt from the left
    expect(box!.x).toBeCloseTo(72 / 612, 2);
    expect(box!.y).toBeCloseTo((792 - 608 - 11 * 0.9) / 792, 2);
    expect(box!.width).toBeGreaterThan(0.3);
  });

  it("finds a quote that spans two lines as two boxes, and one on a later page on that page", async () => {
    const layer = await textLayer(pdf);
    const spans = locateQuote(layer, "La locataire remet douze cheques postdates. Il est interdit d'avoir des enfants")!;
    expect(spans.page).toBe(1);
    expect(spans.boxes).toHaveLength(2);
    expect(spans.boxes[1]!.y).toBeGreaterThan(spans.boxes[0]!.y);
    expect(locateQuote(layer, "Fin du bail : le locataire quitte les lieux le 30 juin 2027.")!.page).toBe(3);
  });

  it("does not guess when the passage is not in the file", async () => {
    expect(locateQuote(await textLayer(pdf), "Le locateur peut reprendre le logement sans preavis.")).toBeNull();
  });
});
