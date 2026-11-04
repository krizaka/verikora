"use client";

import { ProductLockup } from "@krizaka/ui";
import { languagesFor } from "@krizaka/ui/language-switch";
import { NavBar } from "@krizaka/ui/nav-bar";
import { ThemeToggle } from "@krizaka/ui/theme";
import Link from "next/link";
import { Fragment } from "react";

import { BarActions, BarQueryRoot } from "@/components/BarSession";
import { useCodeName } from "@/components/CodeName";
import { PRODUCT_NAME, productEndorsement } from "@/lib/brand";
import { type Locale, translator } from "@/lib/i18n";
import { menuHref, menuItems } from "@/lib/nav";
import { type PageId, pagePath, REPO_URL } from "@/lib/site";

/**
 * The bar of a Krizaka product (products independent): the animated mark, the three places of the site (lib/nav.ts),
 * then the repository, the theme, the language and the one action: using the app (« Sign in », « Try Yomizaka » once sign-up is
 * open, « Open the app » and the avatar when signed in — `BarSession`, a client island: the pages stay static). No « Talk to us »:
 * Contact lives in the footer. No dropdown: the menu is short enough to
 * show. No version chip (the version is in the footer), no family switcher, no link to another product.
 */
/** `provider`: false when the page already wraps the bar in `BarQueryRoot` (the home shares the session answer with its hero). */
export function SiteHeader({
  locale,
  current,
  provider = true,
}: Readonly<{ locale: Locale; current: PageId; provider?: boolean }>) {
  const t = translator(locale);
  const codeName = useCodeName();
  const Root = provider ? BarQueryRoot : Fragment;
  const languages = languagesFor(pagePath(locale, current));
  const home = pagePath(locale, "home");
  const items = menuItems().map((m) => ({
    ...m,
    href: menuHref(locale, m),
    label: t(`chrome.nav.${m.id}`),
    active: m.page === current && !m.hash,
  }));
  return (
    <div className="pointer-events-none sticky top-0 z-50 h-0 px-3" data-site-bar>
      <Root>
        {/* 12 px under the notice (or the top): an offset that takes no room in the flow, so nothing moves below it. */}
        <div className="relative top-3">
          <NavBar.Root label={t("chrome.navLabel")} className="pointer-events-auto mx-auto max-w-(--kz-page-max,72rem)">
            <NavBar.Brand asChild>
              <Link href={home} aria-label={t("chrome.brandHome")}>
                <ProductLockup id="yomizaka" name={PRODUCT_NAME} endorsement={productEndorsement(locale)} {...(codeName ? { codeName } : {})} size={26} />
              </Link>
            </NavBar.Brand>
            <NavBar.Items>
              {items.map((i) => (
                <NavBar.Link key={i.id} asChild active={i.active}>
                  <Link href={i.href}>{i.label}</Link>
                </NavBar.Link>
              ))}
            </NavBar.Items>

            <NavBar.Actions className="gap-1">
              <NavBar.Repo href={REPO_URL} label={t("chrome.sourceCode")} className="hidden lg:inline-flex" />
              <span className="hidden md:inline-flex">
                <ThemeToggle label={t("chrome.themeToggle")} variant="ghost" />
              </span>
              <span className="hidden md:inline-flex">
                <NavBar.Language
                  label={t("chrome.languageLabel")}
                  current={locale}
                  languages={languages}
                  linkAs={Link}
                />
              </span>
              <BarActions locale={locale} placement="bar" />

              <NavBar.Mobile
                openLabel={t("chrome.menu.label")}
                closeLabel={t("chrome.menu.label")}
                className="max-h-[calc(100dvh-6rem)] gap-1 overflow-y-auto overscroll-contain p-3"
              >
                {items.map((i) => (
                  <NavBar.MobileLink key={i.id} asChild active={i.active}>
                    <Link href={i.href}>{i.label}</Link>
                  </NavBar.MobileLink>
                ))}
                <NavBar.MobilePreferences label={t("chrome.preferences")}>
                  <ThemeToggle label={t("chrome.themeToggle")} variant="ghost" />
                  <NavBar.Language
                    label={t("chrome.languageLabel")}
                    current={locale}
                    languages={languages}
                    linkAs={Link}
                  />
                </NavBar.MobilePreferences>
                <BarActions locale={locale} placement="panel" />
              </NavBar.Mobile>
            </NavBar.Actions>
          </NavBar.Root>
        </div>
      </Root>
    </div>
  );
}
