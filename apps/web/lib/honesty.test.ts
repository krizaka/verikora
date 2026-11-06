import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { PricingContent } from "@/components/pricing/PricingContent";
import { SiteFooter } from "@/components/SiteFooter";

import { getDictionary } from "./i18n";
import { llmsText } from "./seo";
import { contactHref, pagePath, SITE_URL } from "./site";

const ROOT = join(__dirname, "..");
const text = (html: string) => html.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/gu, " ");

describe("the public face says only what is true (audit 2026-11-04, krizaka-internal#2349)", () => {
  it.each(["en", "fr"] as const)(
    "the public plans cannot be bought: « request access », never « sign in » (%s)",
    (locale) => {
      const html = renderToStaticMarkup(
        PricingContent({
          locale,
          sold: [{ plan: "agency", price: "49", per: "month", included: 15, overage: null }],
          soon: [],
          freeFirst: false,
          status: "x",
        }),
      );
      const t = getDictionary(locale);
      expect(text(html)).toContain(t.pricing.requestAccess);
      expect(html).toContain(`href="/${locale}/contact"`);
      expect(html).not.toContain(`href="/${locale}/sign-in"`);
      expect(text(html)).toContain(t.pricing.plannedNote);
    },
  );

  it("the public pricing page announces no dated promo code", () => {
    const page = readFileSync(join(ROOT, "app/[locale]/pricing/page.tsx"), "utf8");
    expect(page).not.toMatch(/launch=/);
  });

  it("answers on /contact in both languages, sends support to Krizaka's form (no address), promises no delay", () => {
    expect(existsSync(join(ROOT, "app/[locale]/contact/page.tsx"))).toBe(true);
    for (const locale of ["en", "fr"] as const) {
      const c = getDictionary(locale).contact;
      expect(JSON.stringify(c)).not.toMatch(/ouvrable|business day|\b24 ?h|48 ?h/i);
      expect(sitemap().some((e) => e.url === `${SITE_URL}${pagePath(locale, "contact")}`)).toBe(true);
      const footer = renderToStaticMarkup(SiteFooter({ locale }));
      expect(footer).not.toContain("mailto:");
      expect(footer).toContain(`href="${contactHref("verikora-footer", locale).replaceAll("&", "&amp;")}"`);
      expect(footer).toContain(`href="/${locale}/contact"`);
    }
    expect(llmsText()).not.toMatch(/@(verikora|krizaka)\.com/);
    expect(llmsText()).toContain(contactHref("verikora-llms", "en"));
  });
});
