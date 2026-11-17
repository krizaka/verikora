import { publicBuild } from "./build-target";
import { downloadPageOpen } from "./downloads";
import { PRICING_PUBLISHED } from "./prices/publication";
import type { PageId } from "./site";

/**
 * Whether a page is shown anywhere — the bar, the footer, the sitemap, llms.txt. `/download` is parked while it has no app to download and no video (verikora#389); `/pricing` is held until the price grid is approved (verikora#388, #300). One answer for every surface.
 */
export function isListed(page: PageId): boolean {
  // The public export holds the pages of lib/public-build/routes.mjs: no download page, no terms (a draft, waiting for the lawyer).
  if (publicBuild && (page === "download" || page === "terms")) {
    return false;
  }
  if (page === "download") return downloadPageOpen();
  if (page === "pricing") return PRICING_PUBLISHED;
  return true;
}
