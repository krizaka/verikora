import type { Metadata } from "next";

import { DocsContent } from "@/components/docs/DocsContent";
import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale } from "@/lib/i18n";
import { pageMetadata, siteJsonLd } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "docs");
}

/** Verikora documents itself (verikora#387): how a check works, the API from its OpenAPI document, your data. Static, English and French. */
export default async function Docs({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <SiteHeader locale={locale} current="docs" />
      <main id="content">
        <DocsContent locale={locale} />
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}
