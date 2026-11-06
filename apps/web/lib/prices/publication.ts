/**
 * Whether the public price page is published (yomizaka#388). PUBLISHED since the grid was decided (ADR-0013, 2026-10-29, a
 * decision the founder delegated). Set it back to false to hold the page: `/pricing` then answers 404 and the page leaves the
 * bar, the footer, the sitemap and llms.txt. `lib/prices/publication.test.ts` keeps every surface in step with it.
 */
export const PRICING_PUBLISHED = true;

/**
 * Whether the PUBLIC price page shows the grid. No price on the public pages (meeting of 2026-11-05, wave 1): `/pricing` answers a
 * 308 to the contact page (« request access, write to us») and leaves the bar, the footer, the sitemap and llms.txt. The signed-in
 * plans page (`/app/plans`, PRICING_PUBLISHED) keeps its grid: a customer sees what they pay. The prices come back publicly when the
 * founder decides (krizaka-restricted#315), by flipping this constant and the tests that name it.
 */
export const PRICING_PUBLIC = false;
