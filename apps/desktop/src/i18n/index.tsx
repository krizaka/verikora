import { createI18n, type MessageKey as KeyOf } from "@krizaka/i18n";
import { createI18nReact } from "@krizaka/i18n/react";
import sharedEn from "@verikora/client/messages/en.json";
import sharedFr from "@verikora/client/messages/fr.json";

import ownEn from "./own.en.json";
import ownFr from "./own.fr.json";

export type Locale = "fr" | "en";
export const LOCALES: readonly Locale[] = ["fr", "en"];

/** What the iPhone, Android and Mac apps say the same way (the checks, the stages, the result) is `@verikora/client`'s. */
const fr = { ...ownFr, ...sharedFr, check: { ...ownFr.check, ...sharedFr.check } };
const en = { ...ownEn, ...sharedEn, check: { ...ownEn.check, ...sharedEn.check } };

export type Messages = typeof fr;
export type MessageKey = KeyOf<Messages>;
/** French is the reference of the product (Verikora is made in Montréal): en must have the same keys. */
export const i18n = createI18n<Messages, Locale>({ fr, en }, { defaultLocale: "fr" });
export const { I18nProvider, useI18n } = createI18nReact(i18n);

const STORAGE_KEY = "verikora.locale";
const readLocale = (): Locale => {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    if (stored === "fr" || stored === "en") return stored;
  } catch {
    // Storage refused: the system's language decides.
  }
  return navigator.language.startsWith("en") ? "en" : "fr";
};

let current: Locale = readLocale();
/** The language the app speaks now: the API answers in it too (`Accept-Language`). */
export const currentLocale = (): Locale => current;
export function rememberLocale(locale: Locale): void {
  current = locale;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not remembered: the next launch follows the system.
  }
}
