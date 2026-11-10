import { createI18n, type MessageKey as KeyOf } from "@krizaka/i18n";

import consoleEn from "@/messages/console/en.json";
import consoleFr from "@/messages/console/fr.json";
import documentsEn from "@/messages/documents/en.json";
import documentsFr from "@/messages/documents/fr.json";
import legalEn from "@/messages/legal/en.json";
import legalFr from "@/messages/legal/fr.json";
import marketingEn from "@/messages/marketing/en.json";
import marketingFr from "@/messages/marketing/fr.json";
import screeningEn from "@/messages/screening/en.json";
import screeningFr from "@/messages/screening/fr.json";
import siteEn from "@/messages/site/en.json";
import siteFr from "@/messages/site/fr.json";

/**
 * Messages are split into one catalogue per domain (site, legal, marketing, screening, console, documents) so that PRs
 * touching different areas of the product never conflict on translation files. French is the default language (Verikora
 * is offered in Québec: Charter of the French language, art. 52 and 55; verikora#366) and English stays available by
 * choice. `krizaka-i18n check messages/<domain>` (pnpm lint) verifies each domain independently.
 */
export type Locale = "en" | "fr";

const en = { ...siteEn, ...legalEn, ...marketingEn, ...screeningEn, ...consoleEn, ...documentsEn };
const fr = { ...siteFr, ...legalFr, ...marketingFr, ...screeningFr, ...consoleFr, ...documentsFr };

export type Messages = typeof en;
export type MessageKey = KeyOf<Messages>;

export const LOCALES: readonly Locale[] = ["en", "fr"];

export const i18n = createI18n<Messages, Locale>({ en, fr }, { defaultLocale: "fr" });
export const { getDictionary, asLocale } = i18n;
export const translator = (locale: Locale) => i18n.translator(locale);
export const otherLocale = (locale: Locale): Locale => LOCALES.find((l) => l !== locale) ?? "fr";

export { format } from "@krizaka/i18n";
