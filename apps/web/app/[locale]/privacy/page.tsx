import { Page } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale, format, getDictionary } from "@/lib/i18n";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { pagePath, PRIVACY_OFFICER_EMAIL, PRIVACY_UPDATED } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "privacy");
}

/** What happens to a document, in plain words. */
export default async function Privacy({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <SiteHeader locale={locale} current="privacy" />
      <main id="content">
        <PageHero
          back={{ href: pagePath(locale, "home"), label: t.meta.siteName }}
          linkAs={Link}
          title={t.privacy.title}
          backdrop="plain"
          lead={format(t.privacy.updated, { date: PRIVACY_UPDATED })}
        />
        <Page>
          <p className="max-w-3xl text-lg leading-relaxed text-fg">{t.privacy.body}</p>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-fg" data-privacy-officer>
            <strong>{t.privacy.officer.label}</strong>
            {t.privacy.officer.sep}
            {t.privacy.officer.title} · <a href={`mailto:${PRIVACY_OFFICER_EMAIL}`}>{PRIVACY_OFFICER_EMAIL}</a>
          </p>
          {t.privacy.sections.map((s) => (
            <section key={s.id} id={s.id} className="mt-8 max-w-3xl scroll-mt-(--kz-anchor-offset,6rem)">
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
