import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PricingContent } from "@/components/pricing/PricingContent";
import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale, getDictionary } from "@/lib/i18n";
import { pricingPageView } from "@/lib/prices/pricing-page-view";
import { PRICING_PUBLISHED } from "@/lib/prices/publication";
import { statusLine } from "@/lib/product-status";
import { pageMetadata, siteJsonLd } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "pricing");
}

/**
 * The prices, read from the catalogue in force (`publicCatalogue`: never an internal entry, an entry in preparation without its
 * figure — ADR-009), through `pricingPageView`: read at each request in the dev app, once at build in the public export (one card). HELD behind `PRICING_PUBLISHED` until Oussama approves the grid (verikora#300): a 404 until then.
 */
export default async function Pricing({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  if (!PRICING_PUBLISHED) notFound();
  const locale = asLocale((await params).locale);
  const view = await pricingPageView(locale, new Date());
  if (view.redirectTo) {
    redirect(view.redirectTo);
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
          status={statusLine(getDictionary(locale).landing.status)}
        />
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}
