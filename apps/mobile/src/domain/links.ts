import { CHECKS_TABS, type ChecksTab, type DocumentTab, movedDocumentTab, tagsHref } from "@verikora/core";

/**
 * The URL is the state (addendum 2026-10-17): every screen has the path the web has, under the language, so a link to the
 * web opens the app when it is installed (`associatedDomains`, Android `autoVerify`) and a deep link opens the web.
 */
export type Locale = "fr" | "en";
export const LOCALES: readonly Locale[] = ["fr", "en"];
export const DEFAULT_LOCALE: Locale = "fr";

export const asLocale = (value: string | null | undefined): Locale =>
  LOCALES.find((l) => l === value?.slice(0, 2)) ?? DEFAULT_LOCALE;

const app = (locale: Locale, ...parts: string[]) => ["", locale, "app", ...parts].join("/");

export const routes = {
  verify: (locale: Locale) => app(locale, "check"),
  library: (locale: Locale, library?: string, collection?: string, tags: readonly string[] = []) =>
    tagsHref(
      app(locale, "library", ...[library, library ? collection : undefined].filter((p): p is string => !!p)),
      tags,
    ),
  document: (locale: Locale, id: string, tab: DocumentTab = "rapport") => app(locale, "documents", id, tab),
  /** Vérifications, its first tab at a clean address and « Lots » in the address, as on the web. */
  checks: (locale: Locale, tab: ChecksTab = CHECKS_TABS[0]) => {
    const query = tab === CHECKS_TABS[0] ? "" : `?tab=${tab}`;
    return `${app(locale, "verifications")}${query}`;
  },
  settings: (locale: Locale) => app(locale, "settings"),
} as const;

/** An old document address (`/infos`, `/verifications`…) opens the tab it moved to, the followed run kept (`?analysis=`); an unknown tab opens the report. */
export const legacyDocumentHref = (locale: Locale, id: string, tab: string, analysis?: string | null): string => {
  const query = analysis ? `?analysis=${encodeURIComponent(analysis)}` : "";
  return `${routes.document(locale, id, movedDocumentTab(tab) ?? "rapport")}${query}`;
};

export { parseTagsParam } from "@verikora/core";
