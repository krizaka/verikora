import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PricingContent } from "@/components/pricing/PricingContent";
import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { pageSession } from "@/lib/access";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { asLocale, getDictionary } from "@/lib/i18n";
import { productStatus } from "@/lib/landing";
import { pricingView } from "@/lib/prices/pricing-view";
import { PRICING_PUBLISHED } from "@/lib/prices/publication";
import { pageMetadata, siteJsonLd } from "@/lib/seo";

import preview from "../../../../../dev-preview.json";

/** The prices are data an administrator schedules (ADR-009): the page is read at each request, never frozen at build. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "pricing");
}

/**
 * The prices, read from the catalogue in force (`publicCatalogue`: never an internal entry, an entry in preparation without its
 * figure — ADR-009). HELD behind `PRICING_PUBLISHED` until Oussama approves the grid (verikora#300): a 404 until then.
 */
export default async function Pricing({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  if (!PRICING_PUBLISHED) notFound();
  const locale = asLocale((await params).locale);
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
          status={getDictionary(locale).landing.status[productStatus(preview)]}
        />
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}
