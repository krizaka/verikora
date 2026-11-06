import { CHECKS_TABS, type ChecksTab, type SectionId, sectionsFor } from "@verikora/core";

import { type Locale, routes } from "./links";

/** The route (under `app/[locale]/app/`) that draws each destination of the section map on the phone. */
const SCREENS: Partial<Record<SectionId, { screen: string; href: (locale: Locale) => string }>> = {
  library: { screen: "library", href: (locale) => routes.library(locale) },
  checks: { screen: "verifications", href: (locale) => routes.checks(locale) },
};

export interface PhoneTab {
  id: SectionId;
  /** The tab's route name. */
  screen: string;
  href: string;
}

/**
 * The phone's tab bar: the one section map of `@verikora/core` (verikora#319), the same as the web's rail and the Mac's
 * sidebar. « Vérifier un document » is the header's « + », the account and the settings are under the avatar.
 */
export const phoneTabs = (locale: Locale): PhoneTab[] =>
  sectionsFor("phone").flatMap((section) => {
    const drawn = SCREENS[section.id];
    return drawn ? [{ id: section.id, screen: drawn.screen, href: drawn.href(locale) }] : [];
  });

/** The tab of Vérifications named by the address (`?tab=lots`); an unknown or missing one is the list of checks. */
export const checksTabOf = (raw: string | string[] | undefined): ChecksTab =>
  CHECKS_TABS.find((tab) => tab === (Array.isArray(raw) ? raw[0] : raw)) ?? "checks";
