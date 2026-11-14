import { org, type ProductStatus } from "@krizaka/org";

/**
 * Verikora's one public status, read from @krizaka/org (org rule `product-status-word`): the word is the company's, the same
 * on krizaka.com and here. The sentence of each status is in messages/site (`landing.status`); a status without a sentence
 * there fails the build and the test, never shows a different word.
 */
export const PRODUCT_STATUS: ProductStatus = org.products.find((p) => p.id === "verikora")?.status ?? "development";

export const STATUS_WORD = { en: "In development", fr: "En développement" } as const;

/** The status sentence of the landing (and the plans page), in the page's language. */
export function statusLine(status: Record<string, string>): string {
  const line = status[PRODUCT_STATUS];
  if (!line) throw new Error(`no status sentence for « ${PRODUCT_STATUS} » in messages/site (landing.status)`);
  return line;
}
