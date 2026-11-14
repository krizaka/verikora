import { Alert } from "@krizaka/ui/alert";
import { Page } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale, getDictionary } from "@/lib/i18n";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { TERMS_VERSION } from "@/lib/signup";
import { pagePath } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "terms");
}

/** The terms of use, written in good faith from the law; the French text is the reference. Marked `data-lawyer-review` until the single lawyer review (krizaka/.github#250). */
export default async function Terms({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <SiteHeader locale={locale} current="terms" />
      <main id="content" data-lawyer-review="pending">
        <PageHero
          back={{ href: pagePath(locale, "home"), label: t.meta.siteName }}
          linkAs={Link}
          title={t.terms.title}
          backdrop="plain"
          lead={TERMS_VERSION}
        />
        <Page>
          <Alert tone="warning">{t.terms.status}</Alert>
          {t.terms.sections.map((s) => (
            <section key={s.h} className="mt-8 max-w-3xl">
              <h2 className="text-xl font-semibold">{s.h}</h2>
              <p className="mt-2 text-base leading-relaxed text-fg-secondary">{s.p}</p>
            </section>
          ))}
        </Page>
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}
