import type { Metadata } from "next";
import { permanentRedirect, redirect } from "next/navigation";

import { PricingContent } from "@/components/pricing/PricingContent";
import { SiteHeader } from "@/components/SiteChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { pageSession } from "@/lib/access";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { asLocale, getDictionary } from "@/lib/i18n";
import { productStatus } from "@/lib/landing";
import { pricingView } from "@/lib/prices/pricing-view";
import { PRICING_PUBLIC } from "@/lib/prices/publication";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { pagePath } from "@/lib/site";

import preview from "../../../../../dev-preview.json";

/** The prices are data an administrator schedules (ADR-009): the page is read at each request, never frozen at build. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "pricing");
}

/**
 * The prices, read from the catalogue in force (`publicCatalogue`: never an internal entry, an entry in preparation without its
 * figure — ADR-009). HELD behind `PRICING_PUBLIC`: no price on the public pages (2026-11-05), a 308 to the contact page until the founder decides.
 */
export default async function Pricing({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  if (!PRICING_PUBLIC) {
    permanentRedirect(pagePath(locale, "contact"));
  }
  const view = await pricingView(locale, new Date());
  const session = await pageSession();
  if (session) {
    redirect(`/${locale}${CONSOLE_ROUTES.plans}`);
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <SiteHeader locale={locale} current="pricing" />
      <main id="content">
        <PricingContent
          locale={locale}
          sold={view.sold}
          soon={view.soon}
          freeFirst={view.freeFirst}
          status={getDictionary(locale).landing.status[productStatus(preview)]}
        />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
