import { CheckIcon, HomeIcon, KnowledgeIcon, UsersIcon } from "@krizaka/icons/native";
import { TabBar } from "@krizaka/ui/native";
import type { SectionId } from "@verikora/core";
import { Redirect, Tabs, useRouter } from "expo-router";
import type { ComponentProps } from "react";

import { AUTH, useAuth } from "@/auth";
import { phoneTabs } from "@/domain/tabs";
import { useI18n } from "@/i18n";
import { useLocale } from "@/use-locale";

const ICONS: Record<SectionId, typeof KnowledgeIcon> = {
  library: HomeIcon,
  files: UsersIcon,
  documents: KnowledgeIcon,
  checks: CheckIcon,
};

const iconOf = (Icon: typeof KnowledgeIcon) => (_on: boolean, color: string) => <Icon color={color} />;

/** The bar of the tabs: the section map as items, the active one read from the route, a choice navigating to its address. */
const tabBarOf =
  (items: ComponentProps<typeof TabBar>["items"], label: string, open: (screen: string) => void) =>
  ({ state }: { state: { index: number; routes: readonly { name: string }[] } }) => {
    const active = state.routes[state.index]?.name.split("/")[0] ?? "";
    return <TabBar aria-label={label} items={items} value={active} onValueChange={open} />;
  };

/**
 * The signed-in space: the tabs are the one section map (`phoneTabs`, verikora#319), each a route (the URL is the state).
 * « Vérifier un document » is the header's « + » and the settings are under the avatar: both stay routes, never tabs.
 * Signed out, the way is back to sign-in.
 */
export default function AppLayout() {
  const { t } = useI18n();
  const { status } = useAuth();
  const { locale } = useLocale();
  const router = useRouter();
  if (status === AUTH.signedOut) return <Redirect href="/sign-in" />;
  const tabs = phoneTabs(locale);
  const items = tabs.map((tab) => {
    const Icon = ICONS[tab.id];
    return { value: tab.screen, label: t(`sections.${tab.id}`), icon: iconOf(Icon) };
  });
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={tabBarOf(items, t("tabs.label"), (screen) =>
        router.navigate(tabs.find((tab) => tab.screen === screen)?.href as never),
      )}
    >
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.screen} name={tab.screen} />
      ))}
      <Tabs.Screen name="check" />
      <Tabs.Screen name="settings" />
      <Tabs.Screen name="documents" />
    </Tabs>
  );
}
