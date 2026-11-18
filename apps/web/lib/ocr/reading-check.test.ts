import { describe, expect, it } from "vitest";

import type { TextSource } from "./port";
import { READING_FAILURE, readingProblem } from "./reading-check";
import { VERIKORA_OCR_RULES } from "./rules";

const ocr = (lowConfidence = false): TextSource => ({
  kind: "ocr",
  engine: "tesseract",
  confidence: 80,
  photos: 1,
  lowConfidence,
  origin: null,
});
const check = (text: string, source: TextSource | null, mimeType = "application/pdf") =>
  readingProblem({ text, source, mimeType }, VERIKORA_OCR_RULES);

const RECEIPT = [
  "Runway AI receipt",
  "Date paid: Nov 14, 2026",
  "Subtotal $50.00",
  "QST (9.975%) $4.99",
  "GST (5%) $2.50",
  "Total $57.49 USD",
].join("\n");

describe("the reading check of a document read from an image", () => {
  it("trusts a reading whose amounts add up, the same for any capture", () => {
    expect(check(RECEIPT, ocr())).toBeNull();
  });

  it("refuses a reading Tesseract itself flagged", () => {
    expect(check(RECEIPT, ocr(true))).toBe(READING_FAILURE.lowConfidence);
  });

  it("refuses a page whose amounts column was lost: labels with no figure (the photo of the screen)", () => {
    const lost =
      "Runway AI receipt\nDate paid: Nov 14, 2026\nSubtotal\nQST (9.975%)\nGST (5%)\nTotal USD\nThank you for your business";
    expect(check(lost, ocr())).toBe(READING_FAILURE.amountsMissing);
  });

  it("refuses amounts that do not add up, and never corrects one", () => {
    expect(check(RECEIPT.replace("$57.49", "$51.49"), ocr())).toBe(READING_FAILURE.totalsDoNotAdd);
  });

  it("refuses an image-only PDF whose stray text is a few characters", () => {
    expect(check("Page 1", null)).toBe(READING_FAILURE.tooLittle);
    expect(check("   ", ocr())).toBe(READING_FAILURE.tooLittle);
  });

  it("does not second-guess a text layer or a text file", () => {
    expect(check(`${RECEIPT.replace("$57.49", "$51.49")}`, null)).toBeNull();
    expect(check("Bail", null, "text/plain")).toBeNull();
  });
});
