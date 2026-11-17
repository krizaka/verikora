/** Addresses of the site — structure, not words (the words are in messages/). */
export const SITE_URL = "https://www.verikora.com";
export const REPO_URL = "https://github.com/krizaka/verikora";
/** The one licence the pages name: the file's own (krizaka-internal#4148). */
export const LICENSE_ID = "FSL-1.1-ALv2";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE.md`;
/** Krizaka, the publisher: named only in the footer and the legal mentions (the products are independent). */
export const KRIZAKA_URL = "https://www.krizaka.com";
export const PRIVACY_UPDATED = "2026-11-13";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

/** The public pages, in both languages (sitemap, hreflang). `/download` is parked while no app ships (lib/downloads.ts). The report checker is in the app (`/app/verifications/report`, verikora#389). */
export const PAGES = ["home", "docs", "pricing", "download", "privacy", "terms", "contact"] as const;
export type PageId = (typeof PAGES)[number];
export const pagePath = (locale: "en" | "fr", page: PageId) => (page === "home" ? `/${locale}` : `/${locale}/${page}`);

/** What a message to Krizaka's contact form is: the form's kinds (`topic=`), so each received message says what it is. */
export type ContactKind = "support" | "business" | "other";

/** Krizaka's contact form (the final, localized address: no redirect hop for crawlers), Verikora pre-selected; `source` is `verikora-<page>`. The one builder. */
export function contactHref(source: string, locale: "en" | "fr", kind: ContactKind = "support"): string {
  return `${KRIZAKA_URL}/${locale}/contact?topic=${kind}&product=verikora&source=${encodeURIComponent(source)}`;
}

/** Where sign-in returns to: a path of this site in the page's language, never another address (no open redirect). */
export function safeNext(next: string | undefined, locale: "en" | "fr"): string {
  const home = `/${locale}/app`;
  if (
    !next ||
    !next.startsWith(`/${locale}/`) ||
    next.startsWith("//") ||
    next.includes("\\") ||
    [...next].some((c) => (c.codePointAt(0) ?? 0) < 32)
  ) {
    return home;
  }
  return next;
}
