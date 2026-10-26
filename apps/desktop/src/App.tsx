import { CheckIcon, HomeIcon, KnowledgeIcon, LogoutIcon, SettingsIcon, UsersIcon } from "@krizaka/icons";
import { useQuery } from "@krizaka/query";
import { YomizakaLogo } from "@krizaka/ui";
import { AccountMenu } from "@krizaka/ui/account-menu";
import { AppShell } from "@krizaka/ui/app-shell";
import { Tabs } from "@krizaka/ui/tabs";
import { ThemeToggle } from "@krizaka/ui/theme";
import { CHECKS_TABS, type ChecksTab, type SectionId } from "@yomizaka/core";
import { useCallback, useEffect, useState } from "react";

import { BatchesView, BatchView } from "./components/Batches";
import { CheckView } from "./components/CheckView";
import { Library } from "./components/Library";
import { DocumentView, ReportsView } from "./components/Reports";
import { Settings } from "./components/Settings";
import { StageNotice } from "./components/StageNotice";
import { SignIn } from "./components/SignIn";
import { I18nProvider, type Locale, LOCALES, currentLocale, rememberLocale, useI18n } from "./i18n";
import { APP_VERSION, queries, stage, yomizaka } from "./lib/config";
import { bridge, folders, followLinks, setNativeMenu } from "./lib/desktop";
import { macSections, MENU_IDS, menuSpec } from "./lib/menu";
import { hashOf, type Route, routeOfLink, sectionOf } from "./lib/route";
import { AUTH, useAuth } from "./lib/use-auth";
import { useRoute } from "./lib/use-route";

export function App() {
  const [locale, setLocale] = useState<Locale>(currentLocale());
  const choose = useCallback((next: Locale) => {
    rememberLocale(next);
    setLocale(next);
  }, []);
  return (
    <I18nProvider locale={locale} setLocale={choose}>
      <StageNotice stage={stage} />
      <Gate onLocale={choose} />
    </I18nProvider>
  );
}

const LANGUAGE_NAMES: Record<Locale, string> = { fr: "Français", en: "English" };
const SECTION_ICONS: Record<SectionId, typeof HomeIcon> = { library: HomeIcon, files: UsersIcon, documents: KnowledgeIcon, checks: CheckIcon };
/** Where a destination of the section map opens: Vérifications opens on its first tab, the checked documents. */
const SECTION_ROUTES: Partial<Record<SectionId, Route>> = { library: { screen: "library", folder: null }, checks: { screen: "reports" } };
const TAB_ROUTES: Record<ChecksTab, Route> = { checks: { screen: "reports" }, lots: { screen: "batches" } };

/**
 * Signed out, the sign-in; signed in, the window (krizaka-ui ADR-002: `AppShell desktop`, its header and sidebar are the
 * title bar). The signed-in account is always in the header (Oussama's decision, 2026-10-23). The screen is the hash; the
 * native menu and `yomizaka://` links move it too.
 */
function Gate({ onLocale }: Readonly<{ onLocale: (locale: Locale) => void }>) {
  const { t, messages, locale } = useI18n();
  const status = useAuth();
  const [route, go] = useRoute();

  const addFolder = useCallback(
    () =>
      void folders.grant().then((granted) => {
        if (granted) go({ screen: "library", folder: granted });
      }),
    [go],
  );
  useEffect(() => {
    if (status !== AUTH.signedIn) return;
    const handlers: Record<string, () => void> = {
      [MENU_IDS.addFolder]: addFolder,
      ...Object.fromEntries(macSections().flatMap((s) => (SECTION_ROUTES[s.id] ? [[s.menuId, () => go(SECTION_ROUTES[s.id]!)]] : []))),
      [MENU_IDS.settings]: () => go({ screen: "settings" }),
    };
    const stops = [setNativeMenu(bridge, menuSpec(messages), handlers), followLinks(bridge, (link) => go(routeOfLink(link)))];
    return () => void Promise.all(stops).then((all) => all.forEach((stop) => stop()));
  }, [status, messages, addFolder, go]);

  if (status === AUTH.loading) return null;
  if (status === AUTH.signedOut) return <SignIn />;
  const section = sectionOf(route);
  const item = (to: Route, current: boolean) => ({ href: hashOf(to), current });
  return (
    <AppShell.Root desktop skipLabel={t("shell.skip")} collapseShortcut={false}>
      <AppShell.Sidebar
        label={t("nav.label")}
        brand={
          <>
            <YomizakaLogo size={22} animated={false} /> {t("app.name")}
          </>
        }
        collapseLabels={[t("shell.collapse"), t("shell.expand")]}
        closeLabel={t("shell.close")}
        footer={<AppShell.Item icon={<SettingsIcon size={16} />} label={t("nav.settings")} {...item({ screen: "settings" }, section === "settings")} />}
      >
        {/* The section map of @yomizaka/core, the same as the web's rail and the phone's tabs (yomizaka#319). */}
        {macSections().flatMap((s) => {
          const to = SECTION_ROUTES[s.id];
          if (!to) return [];
          const Icon = SECTION_ICONS[s.id];
          return [<AppShell.Item key={s.id} icon={<Icon size={16} />} label={t(`sections.${s.id}`)} shortcut={s.shortcut} {...item(to, section === s.id)} />];
        })}
      </AppShell.Sidebar>
      <AppShell.Body>
        <AppShell.Header title={section === "settings" ? t("nav.settings") : t(`sections.${section}`)} menuLabel={t("shell.menu")} actions={<Account locale={locale} onLocale={onLocale} go={go} />} />
        <AppShell.Main className="min-h-0">
          {route.screen === "reports" || route.screen === "batches" ? <ChecksTabs current={hashOf(route)} /> : null}
          {route.screen === "library" ? <Library folder={route.folder} go={go} onAddFolder={addFolder} /> : null}
          {route.screen === "check" ? <CheckView documentId={route.documentId} analysisId={route.analysisId} go={go} /> : null}
          {route.screen === "document" ? <DocumentView documentId={route.documentId} go={go} /> : null}
          {route.screen === "batches" ? <BatchesView go={go} /> : null}
          {route.screen === "batch" ? <BatchView batchId={route.batchId} go={go} /> : null}
          {route.screen === "reports" ? <ReportsView go={go} /> : null}
          {route.screen === "settings" ? <Settings /> : null}
        </AppShell.Main>
      </AppShell.Body>
    </AppShell.Root>
  );
}

/** Vérifications holds the batches as its second tab (« Lots »), as on the web and the phone: each tab is its own hash. */
function ChecksTabs({ current }: Readonly<{ current: string }>) {
  const { t } = useI18n();
  return (
    <Tabs.Nav label={t("checksTabs.label")} current={current} className="mb-4">
      {CHECKS_TABS.map((tab) => (
        <Tabs.NavLink key={tab} href={hashOf(TAB_ROUTES[tab])} exact>
          {t(`checksTabs.${tab}`)}
        </Tabs.NavLink>
      ))}
    </Tabs.Nav>
  );
}

/** The header's account menu: who is signed in, the settings, the theme, the language, sign out — at every width. */
function Account({ locale, onLocale, go }: Readonly<{ locale: Locale; onLocale: (locale: Locale) => void; go: (route: Route) => void }>) {
  const { t } = useI18n();
  const me = useQuery(queries.me());
  const email = me.data?.email ?? "";
  // The account's name when it has one; otherwise the e-mail alone (never shown twice).
  const name = me.data?.name ?? undefined;
  return (
    <AccountMenu
      label={t("shell.account")}
      name={name ?? email}
      email={name ? email : undefined}
      showName
      avatar={{ defaultAvatar: { brand: "yomizaka", seed: me.data?.avatarSeed ?? email }, fallback: (name || email || "Y").charAt(0).toUpperCase() }}
      links={[{ id: "settings", label: t("nav.settings"), href: hashOf({ screen: "settings" }), icon: <SettingsIcon size={16} /> }]}
      language={{ label: t("shell.language"), value: locale, options: LOCALES.map((value) => ({ value, label: LANGUAGE_NAMES[value] })), onChange: (to) => onLocale(to as Locale) }}
      signOut={{ label: t("nav.signOut"), onSelect: () => void yomizaka.signOut().then(() => go({ screen: "library", folder: null })), icon: <LogoutIcon size={16} /> }}
    >
      <div className="px-3 py-1">
        <ThemeToggle label={t("shell.theme")} variant="ghost" />
      </div>
      <p className="px-3 py-1 text-xs text-fg-muted">{t("settings.version", { version: APP_VERSION })}</p>
    </AccountMenu>
  );
}
