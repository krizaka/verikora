import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { extractPdfText } from "./extraction/isolated";
import { readText } from "./pdf-text";
import { understanding } from "./understanding";

/**
 * A foreign SaaS invoice laid out like Stripe's (fixtures/stripe-like-invoice, invented): the real one, from Runway, was refused as
 * « UNREADABLE_FILE » because its text layer carries U+0000, which Postgres rejects (krizaka-internal#4028).
 */
const bytes = new Uint8Array(
  readFileSync(new URL("../../../fixtures/stripe-like-invoice/invoice-synthetic-usd.pdf", import.meta.url)),
);

describe("a Stripe-style USD invoice whose text layer holds NUL characters", () => {
  it("the fixture does reproduce the fault: pdf.js hands back U+0000", async () => {
    const raw = await extractPdfText(bytes);
    expect(raw.text).toContain("\u0000");
  });

  it("is read into text the database accepts, with the invoice number and the taxes intact", async () => {
    const read = await readText("application/pdf", bytes);
    expect(read.text).not.toContain("\u0000");
    expect(read.text).toContain("Invoice number SYNTH-0001");
    expect(read.text).toContain("QST - Quebec 9.975% on $50.00 $4.99");
    expect(read.text).toContain("Amount due $57.49 USD");
  });

  it("is told apart as an invoice, so the invoice check applies", async () => {
    const read = await readText("application/pdf", bytes);
    expect(understanding.understand(read.text, { pages: read.pages }).nature?.id).toBe("invoice");
  });
});
