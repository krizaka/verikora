import "@krizaka/ui/product-page.css";

import { ProductPage } from "@krizaka/ui/product-page";
import type { Metadata } from "next";

import { BarQueryRoot } from "@/components/BarSession";
import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale, getDictionary } from "@/lib/i18n";
import { homePageData } from "@/lib/product-page-data";
import { statusLine } from "@/lib/product-status";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { contactHref } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "home");
}

/**
 * The home is `ProductPage` of @krizaka/ui (krizaka-internal#4692, #4634): the sentence beside the recorded check, the one journey
 * told while scrolling, the clause the visitor touches, the scenes the media registry lists, what it does not do, one way in.
 * The page holds no words and no product's name: `homePageData` builds the template's data from the catalogue, the registry and
 * the recorded run. The status sentence (the company's word, `@krizaka/org`) closes the page, above the footer. Static.
 */
export default async function Home({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const data = homePageData(locale, {
    demo: (source) => contactHref(source, locale, "business"),
    sample: "#proof",
  });
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <BarQueryRoot>
        <SiteHeader locale={locale} current="home" provider={false} />
        <main id="content" data-landing>
          <ProductPage data={data} />
          <p className="mx-auto max-w-[60ch] px-4 py-8 text-center text-sm text-fg-secondary" data-testid="hero-status">
            {statusLine(getDictionary(locale).landing.status)}
          </p>
        </main>
      </BarQueryRoot>
      <ProductFooter locale={locale} />
    </>
  );
}
