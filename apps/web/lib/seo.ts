/* Search engines and AI assistants (the Krizaka family contract, scripts/check-seo-family.mjs): canonical, hreflang,
   social cards and the JSON-LD of the site, every node leading back to the Krizaka Organization (the publisher). */
import type { Metadata } from "next";

import { getDictionary, type Locale } from "./i18n";
import { isListed } from "./listed";
import { KRIZAKA_URL, type PageId, pagePath, REPO_URL, SITE_URL } from "./site";
import { ENGINE_NAME, PRODUCT_NAME } from "./brand";

export const ORG_ID = `${KRIZAKA_URL}/#organization`;
const ORG = { "@type": "Organization", "@id": ORG_ID, name: "Krizaka", url: KRIZAKA_URL };
export const OG_IMAGE = `${SITE_URL}/og.png`;

/** The search bots and AI crawlers the whole family welcomes — the same list on every site. */
export const CRAWLERS = [
  "Googlebot",
  "Google-Extended",
  "Bingbot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "anthropic-ai",
  "Applebot",
  "Applebot-Extended",
  "CCBot",
] as const;

const url = (locale: Locale, page: PageId) => `${SITE_URL}${pagePath(locale, page)}`;

export function pageMetadata(locale: Locale, page: PageId): Metadata {
  const t = getDictionary(locale);
  const titles: Record<Exclude<PageId, "home">, string> = {
    docs: t.docs.title,
    pricing: t.pricing.title,
    download: t.download.title,
    privacy: t.privacy.title,
    terms: t.terms.title,
  };
  const title = page === "home" ? `${t.meta.siteName} · ${t.landing.title}` : `${titles[page]} · ${t.meta.siteName}`;
  const description = t.meta.description;
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: url(locale, page),
      languages: { en: url("en", page), fr: url("fr", page), "x-default": url("fr", page) },
    },
    openGraph: {
      type: "website",
      siteName: t.meta.siteName,
      title,
      description,
      url: url(locale, page),
      locale: locale === "en" ? "en_CA" : "fr_CA",
      alternateLocale: locale === "en" ? "fr_CA" : "en_CA",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: t.meta.siteName }],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE] },
  };
}

/** The site and the application it presents, both published by Krizaka. Nothing is offered: no `offers`, no store. */
export function siteJsonLd(locale: Locale) {
  const t = getDictionary(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: t.meta.siteName,
        inLanguage: ["en", "fr"],
        publisher: ORG,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: t.meta.siteName,
        url: `${SITE_URL}/`,
        description: t.meta.description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        codeRepository: REPO_URL,
        publisher: ORG,
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
    ],
  };
}

/** llms.txt (llmstxt.org): what the site is, its pages, its source and its publisher. */
export function llmsText(): string {
  const en = getDictionary("en");
  return `# ${en.meta.siteName}

> ${en.meta.description}
> A product of Krizaka (Montréal), in development: sign-up is closed. Powered by ${ENGINE_NAME}; every analysis keeps its run id.

## Key pages
- [${getDictionary("fr").meta.siteName}](${SITE_URL}/fr) · [${PRODUCT_NAME} (en)](${SITE_URL}/en): what it does for you, and one real check recorded as it came back
- [${getDictionary("fr").docs.title}](${SITE_URL}/fr/docs) · [${en.docs.title} (en)](${SITE_URL}/en/docs): how a check works, the API (OpenAPI at ${SITE_URL}/api/v1/openapi.json), your data
${isListed("pricing") ? `- [${getDictionary("fr").pricing.title}](${SITE_URL}/fr/pricing) · [${en.pricing.title} (en)](${SITE_URL}/en/pricing): the prices, read from the catalogue\n` : ""}- [${getDictionary("fr").privacy.title}](${SITE_URL}/fr/privacy) · [${en.privacy.title} (en)](${SITE_URL}/en/privacy)
- Signed reports are verified by signed-in members the report's owner gave access to; there is no public verification.
- [Talk to us about ${PRODUCT_NAME}](${KRIZAKA_URL}/en/contact?topic=yomizaka): the one way to reach the team
## Source

- [${PRODUCT_NAME} repository](${REPO_URL}): the app, its BFF and its contracts (Apache-2.0)

## Publisher

- [Krizaka](${KRIZAKA_URL}): the company, an open-source software studio in Montréal

Languages: French and English. Sitemap: ${SITE_URL}/sitemap.xml
`;
}
