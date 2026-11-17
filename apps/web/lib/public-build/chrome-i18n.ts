import { createI18n } from "@krizaka/i18n";

import siteEn from "@/messages/site/en.json";
import siteFr from "@/messages/site/fr.json";

/**
 * The public export's `lib/i18n` FOR THE BROWSER (aliased by next.config.public.mjs, browser condition only): the bar is a client
 * component and reads its words from the dictionary, which would otherwise ship every catalogue of the app — the console, the
 * administration, the sign-in screens — to a visitor of a site that has none of them. Only the bar's words are kept, without the
 * account entries. The server keeps the full dictionary (`lib/i18n.ts`): the pages read it at build.
 */
export type Locale = "en" | "fr";

const ACCOUNT_WORDS = ["signIn", "signOut", "tryIt", "openApp", "myDocuments", "account", "settings"] as const;
const barWords = ({ chrome }: typeof siteEn) =>
  ({
    chrome: Object.fromEntries(
      Object.entries(chrome).filter(([id]) => !(ACCOUNT_WORDS as readonly string[]).includes(id)),
    ),
  }) as unknown as typeof siteEn;

export const LOCALES: readonly Locale[] = ["en", "fr"];
export const i18n = createI18n<typeof siteEn, Locale>(
  { en: barWords(siteEn), fr: barWords(siteFr) },
  { defaultLocale: "fr" },
);
export const { getDictionary, asLocale } = i18n;
export const translator = (locale: Locale) => i18n.translator(locale);
export const otherLocale = (locale: Locale): Locale => LOCALES.find((l) => l !== locale) ?? "fr";
export { format } from "@krizaka/i18n";
