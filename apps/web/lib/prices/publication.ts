/**
 * Whether the public price page is published (verikora#388). PUBLISHED since the grid was decided (ADR-0013, 2026-10-29, a
 * decision the founder delegated). Set it back to false to hold the page: `/pricing` then answers 404 and the page leaves the
 * bar, the footer, the sitemap and llms.txt. `lib/prices/publication.test.ts` keeps every surface in step with it.
 */
export const PRICING_PUBLISHED = true;
