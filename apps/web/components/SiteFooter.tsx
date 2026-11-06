import { org } from "@krizaka/org";
import { SiteFooter as FamilyFooter, SiteFooterColumn, SiteFooterLink } from "@krizaka/ui/site-footer";
import { orgFamilyLabels } from "@krizaka/ui/sites";
import Link from "next/link";

import { BRAND_ID, PRODUCT_NAME } from "@/lib/brand";
import { type Locale, translator } from "@/lib/i18n";
import { indexable } from "@/lib/indexing";
import { isListed } from "@/lib/listed";
import { APP_VERSION, pagePath, REPO_URL, SUPPORT_EMAIL } from "@/lib/site";

/**
 * The footer is @krizaka/ui's SiteFooter in product mode (`family={false}`): the product's pages, its source and contact,
 * the publisher line « A Krizaka product » (→ www.krizaka.com), DEV · the version. The signature line (« Une entreprise de
 * Technologies Krizaka · Fait à Montréal ») and the legal links are the organisation's own facts (`@krizaka/org`), never typed here.
 */
export function SiteFooter({ locale }: Readonly<{ locale: Locale }>) {
  const t = translator(locale);
  return (
    <FamilyFooter
      current={BRAND_ID}
      family={false}
      labels={orgFamilyLabels(org, locale)}
      org={org}
      version={APP_VERSION}
      aria-label={t("chrome.footerLabel")}
      env={indexable() ? undefined : "DEV"}
      data-testid="app-version"
    >
      <SiteFooterColumn title={PRODUCT_NAME}>
        {isListed("download") ? (
          <SiteFooterLink asChild>
            <Link href={pagePath(locale, "download")}>{t("chrome.download")}</Link>
          </SiteFooterLink>
        ) : null}
        <SiteFooterLink asChild>
          <Link href={pagePath(locale, "docs")}>{t("chrome.docs")}</Link>
        </SiteFooterLink>
        {isListed("pricing") ? (
          <SiteFooterLink asChild>
            <Link href={pagePath(locale, "pricing")}>{t("chrome.nav.pricing")}</Link>
          </SiteFooterLink>
        ) : null}
        <SiteFooterLink asChild>
          <Link href={pagePath(locale, "privacy")}>{t("chrome.legal")}</Link>
        </SiteFooterLink>
        <SiteFooterLink asChild>
          <Link href={pagePath(locale, "terms")}>{t("chrome.terms")}</Link>
        </SiteFooterLink>
        <SiteFooterLink href={REPO_URL}>{t("chrome.sourceCode")}</SiteFooterLink>
        <SiteFooterLink asChild>
          <Link href={pagePath(locale, "contact")}>{t("chrome.contact")}</Link>
        </SiteFooterLink>
        <SiteFooterLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</SiteFooterLink>
      </SiteFooterColumn>
    </FamilyFooter>
  );
}
