import { Page } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { asLocale, getDictionary } from "@/lib/i18n";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { ButtonLink } from "@/components/ButtonLink";
import { contactHref, pagePath } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "contact");
}

/** How to reach the team: Krizaka's contact form with the kind « support » and the product (no address is public, founder 2026-11-06), no promised delay. */
export default async function Contact({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <SiteHeader locale={locale} current="contact" />
      <main id="content">
        <PageHero
          back={{ href: pagePath(locale, "home"), label: t.meta.siteName }}
          linkAs={Link}
          title={t.contact.title}
          backdrop="plain"
          lead={t.contact.lead}
        />
        <Page>
          <section className="max-w-3xl">
            <h2 className="text-xl font-semibold">{t.contact.supportLabel}</h2>
            <p className="mt-2 text-base leading-relaxed text-fg-secondary">{t.contact.supportText}</p>
            <p className="mt-4">
              <ButtonLink href={contactHref("verikora-contact", locale)}>{t.contact.supportCta}</ButtonLink>
            </p>
            <p className="mt-6 text-base leading-relaxed text-fg-secondary">
              <Link href={pagePath(locale, "privacy")}>{t.contact.privacyText}</Link>
            </p>
          </section>
        </Page>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
