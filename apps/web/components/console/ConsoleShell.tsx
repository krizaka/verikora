"use client";

import {
  CheckIcon,
  HomeIcon,
  KnowledgeIcon,
  PlusIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
} from "@krizaka/icons";
import { krizakaFetch, useMutation } from "@krizaka/query";
import { YomizakaLogo } from "@krizaka/ui";
import { AppFrame } from "@krizaka/ui/app-frame";
import { Badge } from "@krizaka/ui/badge";
import { languagesFor } from "@krizaka/ui/language-switch";
import { type SectionId, sectionsFor } from "@yomizaka/core";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ButtonLink } from "@/components/ButtonLink";
import { activeNav, CONSOLE_ROUTES, withoutLocale } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { ConsoleSearch } from "./ConsoleSearch";
import { PRODUCT_NAME } from "@/lib/brand";

const BUILD = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const ADMIN_URL = "https://admin.yomizaka.com";
const SECTION_ICONS: Record<SectionId, typeof HomeIcon> = {
  library: HomeIcon,
  files: UsersIcon,
  documents: KnowledgeIcon,
  checks: CheckIcon,
};

/**
 * The frame of the signed-in space: Krizaka UI's `AppFrame` (krizaka/yomizaka#429) — one rail, one top bar, one account menu for the
 * whole family, the top chrome (the bar and the development notice) owned by the frame (#449). What is ours is the data: where you work
 * on the rail — the section map of `@yomizaka/core`, the same on the phone and the Mac (yomizaka#319): Bibliothèque ·
 * Dossiers (offered with the applicant-file flow) · Vérifications · Recherche, the collapse control alone at its foot —; the
 * product's name in the header with the DEV chip and the one action of every screen, « Vérifier un document »;
 * who you are under the avatar: profile, settings (the settings home), billing, Administration for an administrator, then language, theme, sign out (the frame's order).
 * The active entry comes from the route (lib/console-nav.ts), never from local state; each page draws its own `h1` (`PageHeader`).
 */
export function ConsoleShell({
  locale,
  email,
  name,
  avatarSeed,
  role,
  applicantFiles = false,
  toDecide = 0,
  children,
}: Readonly<{
  locale: "en" | "fr";
  email: string;
  name?: string;
  avatarSeed?: string;
  role: "USER" | "ADMIN";
  applicantFiles?: boolean;
  toDecide?: number;
  children: React.ReactNode;
}>) {
  const { say } = useSay();
  const router = useRouter();
  const path = usePathname() ?? "";
  const [searching, setSearching] = useState(false);
  const active = activeNav(path);
  const href = (to: string) => `/${locale}${to}`;
  const signOut = useMutation({
    mutationFn: () => krizakaFetch("/api/auth/sign-out", { method: "POST" }),
    onSettled: () => {
      router.replace(`/${locale}/sign-in`);
      router.refresh();
    },
  });
  const languages = languagesFor(`/${locale}${withoutLocale(path)}`);
  const sections = sectionsFor("web", { applicantFiles }).map((section) => {
    const Icon = SECTION_ICONS[section.id];
    return {
      id: section.id,
      label: say(`sections.${section.id}`),
      href: href(section.path),
      icon: <Icon size={22} />,
      ...(section.id === "files" && toDecide > 0
        ? {
            badge: toDecide,
            badgeLabel: say(pluralKey("shell.toDecide", toDecide), {
              count: toDecide,
            }),
          }
        : {}),
    };
  });
  return (
    <>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:rounded-sm focus:bg-surface-1 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        {say("shell.skip")}
      </a>
      <AppFrame
        name={PRODUCT_NAME}
        mark={<YomizakaLogo size={28} animated={false} />}
        headerMark={<YomizakaLogo size={26} animated={false} />}
        homeHref={href(CONSOLE_ROUTES.library)}
        accent="yomizaka"
        label={say("shell.sidebarLabel")}
        locale={locale}
        linkAs={Link}
        sections={sections}
        currentId={active ?? undefined}
        chips={
          BUILD ? (
            <Badge tone="neutral" size="sm" className="hidden sm:inline-flex" data-testid="app-version">
              {say("shell.devBuild", { version: BUILD })}
            </Badge>
          ) : undefined
        }
        // The signed-in person is always visible (yomizaka#243): the name only when there is one, never the raw e-mail address
        // (the review's A4); the menu's identity header carries both. No messages (the product has no messaging) and no notifications
        // until `@krizaka/notifications` gives it something to say (krizaka-ts#60): an empty slot is hidden, never invented.
        account={{
          // A person with no name is "Account" beside the avatar, never the raw address (the frame shows the e-mail when it has no name).
          name: name ?? say("shell.account"),
          email,
          avatar: {
            defaultAvatar: { brand: "yomizaka", seed: avatarSeed ?? email },
            fallback: (name ?? email).charAt(0).toUpperCase(),
          },
          links: {
            profile: {
              href: href(`${CONSOLE_ROUTES.account}/profil`),
              icon: <UserIcon size={16} />,
            },
            settings: {
              href: href(CONSOLE_ROUTES.account),
              icon: <SettingsIcon size={16} />,
            },
            billing: {
              href: href(`${CONSOLE_ROUTES.account}/facturation`),
              label: say("shell.billing"),
              icon: <WalletIcon size={16} />,
            },
            ...(role === "ADMIN"
              ? {
                  administration: {
                    href: ADMIN_URL,
                    icon: <ShieldIcon size={16} />,
                  },
                }
              : {}),
          },
          onSignOut: () => signOut.mutate(),
        }}
        language={{
          value: locale,
          options: languages.map((l) => ({ value: l.code, label: l.name })),
          onChange: (to) => {
            const target = languages.find((l) => l.code === to);
            if (target) router.push(target.href);
          },
        }}
        search={{
          label: say("shell.palette.label"),
          onOpen: () => setSearching(true),
        }}
        primary={
          // The one action of every signed-in screen — except the home, whose drop zone IS the action (one primary per page): its word from `sm`, its icon and accessible name below.
          active === "library" && withoutLocale(path).replace(/\/$/, "") === CONSOLE_ROUTES.library ? undefined : (
            <ButtonLink
              href={href(CONSOLE_ROUTES.check)}
              variant="gradient"
              size="sm"
              shape="cut"
              aria-label={say("shell.checkAction")}
              title={say("shell.checkAction")}
              data-testid="header-check"
            >
              <PlusIcon size={16} aria-hidden />
              <span className="hidden sm:inline">{say("shell.checkAction")}</span>
            </ButtonLink>
          )
        }
      >
        <main id="content" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none sm:px-6">
          {children}
        </main>
      </AppFrame>
      <ConsoleSearch open={searching} onOpenChange={setSearching} />
    </>
  );
}
