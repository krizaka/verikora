import type { OcrRules } from "./port";

/** Verikora's OCR rules — data. French first: the documents are Québec's. */
export const VERIKORA_OCR_RULES: OcrRules = { languages: ["fra", "eng"], minConfidence: 70, minChars: 40 };
