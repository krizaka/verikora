"use client";

import { BillingIcon, BookmarkIcon, LockIcon, ServerIcon, ShieldIcon, SunIcon, UserIcon } from "@krizaka/icons";
import { AccountProfileCard } from "@krizaka/ui/account-settings";
import { SettingsLayout } from "@krizaka/ui/settings-layout";
import Link from "next/link";
import type { ReactNode } from "react";

import { useAppConfig } from "@/lib/app-config-client";
import { BRAND_ID } from "@/lib/brand";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";

import { formatDate } from "./format";

/** Who is signed in, for the identity card on top of the settings (the review's E5). */
export interface SettingsAccount {
  email: string;
  name: string | null;
  avatarSeed: string | null;
  verified: boolean;
  /** When the account was created (ISO). */
  memberSince: string;
}

const ICONS = {
  profil: UserIcon,
  apparence: SunIcon,
  securite: LockIcon,
  facturation: BillingIcon,
  stockage: ServerIcon,
  signets: BookmarkIcon,
  donnees: ShieldIcon,
} as const;

/**
 * The settings on `SettingsLayout` (flat: one calm column, rows divided by hairlines), the identity card on top, the six
 * sections as routes in its navigation (chips that wrap on a phone — the review's E1), the current one from the route.
 */
export function SettingsShell({
  section,
  account,
  children,
}: Readonly<{ section: SettingsSection; account: SettingsAccount; children: ReactNode }>) {
  const { say, locale } = useSay();
  const app = useAppConfig();
  const sections = SETTINGS_SECTIONS.filter((s) => s !== "stockage" || app?.features.ownStorage !== false);
  const nav = sections.map((s) => {
    const Icon = ICONS[s];
    return {
      id: s,
      label: say(`settings.tabs.${s}`),
      href: `/${locale}/app/settings/${s}`,
      icon: <Icon size={16} />,
      current: s === section,
    };
  });
  const title = account.name ?? account.email;
  return (
    <SettingsLayout
      variant="flat"
      navLabel={say("settings.label")}
      nav={[{ id: "account", label: say("settings.label"), items: nav }]}
      linkAs={Link}
      header={
        <AccountProfileCard
          name={title}
          email={account.email}
          verified={account.verified}
          verifiedLabel={say("settings.verified")}
          unverifiedLabel={say("settings.unverified")}
          memberSince={say("settings.memberSince", { date: formatDate(account.memberSince, locale) })}
          avatar={{
            defaultAvatar: { brand: BRAND_ID, seed: account.avatarSeed ?? account.email },
            fallback: title.charAt(0).toUpperCase(),
          }}
          data-testid="settings-identity"
        />
      }
    >
      {children}
    </SettingsLayout>
  );
}
