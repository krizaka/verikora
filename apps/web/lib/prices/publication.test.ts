import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { SiteFooter } from "@/components/SiteFooter";

import { isListed } from "../listed";
import { menuItems } from "../nav";
import { llmsText } from "../seo";
import { SITE_URL } from "../site";
import { PRICING_PUBLIC, PRICING_PUBLISHED } from "./publication";

/** The grid is decided (ADR-0013): the page is published, and every surface offers it; held again, none would and the page would be a 404. */
const ROOT = join(import.meta.dirname, "../..");

describe("the pricing page is published once the grid is decided (#388, ADR-0013)", () => {
  it("is published inside the app, with its decision record; the public page shows no price (2026-11-05)", () => {
    expect(PRICING_PUBLISHED).toBe(true);
    expect(PRICING_PUBLIC).toBe(false);
    expect(existsSync(join(ROOT, "../../docs/adr/ADR-0013-price-grid.md"))).toBe(true);
  });

  it("every surface follows the constant: the bar, the footer, the sitemap and llms.txt", () => {
    const offered = PRICING_PUBLIC;
    expect(isListed("pricing")).toBe(offered);
    expect(menuItems().some((m) => m.page === "pricing")).toBe(offered);
    for (const locale of ["en", "fr"] as const) {
      expect(renderToStaticMarkup(SiteFooter({ locale })).includes(`href="/${locale}/pricing"`)).toBe(offered);
      expect(sitemap().some((e) => e.url === `${SITE_URL}/${locale}/pricing`)).toBe(offered);
    }
    expect(llmsText().includes("/pricing")).toBe(offered);
  });

  it("the public page answers a permanent redirect to the contact page while no price is public", () => {
    const page = readFileSync(join(ROOT, "app/[locale]/pricing/page.tsx"), "utf8");
    expect(existsSync(join(ROOT, "app/[locale]/pricing/page.tsx"))).toBe(true);
    expect(page).toContain('if (!PRICING_PUBLIC) permanentRedirect(pagePath(locale, "contact"));');
  });
});
