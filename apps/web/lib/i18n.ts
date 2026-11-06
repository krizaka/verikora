import { createI18n, type MessageKey as KeyOf } from "@krizaka/i18n";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/**
 * Every user-facing string lives in messages/<locale>.json. French is the default language (Verikora is offered in Québec:
 * Charter of the French language, art. 52 and 55; verikora#366) and English stays available by choice; en.json is the
 * reference of the *shape* (fr.json type-checks against it); `krizaka-i18n check` (pnpm lint) checks the rest.
 */
export type Locale = "en" | "fr";
export type Messages = typeof en;
export type MessageKey = KeyOf<Messages>;

export const LOCALES: readonly Locale[] = ["en", "fr"];

export const i18n = createI18n<Messages, Locale>({ en, fr }, { defaultLocale: "fr" });
export const { getDictionary, asLocale } = i18n;
export const translator = (locale: Locale) => i18n.translator(locale);
export const otherLocale = (locale: Locale): Locale => LOCALES.find((l) => l !== locale) ?? "fr";

export { format } from "@krizaka/i18n";
