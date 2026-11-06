"use client";

import { ClockIcon, HomeIcon, KeepIcon, LogoutIcon, ServerIcon, ShieldIcon, UsersIcon } from "@krizaka/icons";
import { krizakaFetch, useMutation } from "@krizaka/query";
import { YomizakaLogo } from "@krizaka/ui";
import { AppShell } from "@krizaka/ui/app-shell";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { languagesFor, LanguageSwitch } from "@krizaka/ui/language-switch";
import { ThemeToggle } from "@krizaka/ui/theme";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment } from "react";

import { ADMIN_GROUPS, ADMIN_PAGES } from "@/lib/admin-nav";
import { PRODUCT_NAME } from "@/lib/brand";
import { useSay } from "@/lib/i18n-client";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/** admin.verikora.com: @krizaka/ui's AppShell console — overview, people, documents, Sovkora runs, audit — and a DEV badge. */
export function AdminShell({
  locale,
  email,
  children,
}: Readonly<{ locale: "en" | "fr"; email: string; children: React.ReactNode }>) {
  const { say } = useSay();
  const router = useRouter();
  const path = usePathname() ?? "";
  const home = `/${locale}`;
  const rest = path.slice(home.length);
  const signOut = useMutation({
    mutationFn: () => krizakaFetch("/api/auth/sign-out", { method: "POST" }),
    onSettled: () => {
      router.replace(`${home}/sign-in`);
      router.refresh();
    },
  });
  const ICONS = {
    overview: <HomeIcon />,
    users: <UsersIcon />,
    documents: <KeepIcon />,
    flows: <ShieldIcon />,
    config: <ServerIcon />,
    storage: <KeepIcon />,
    runs: <ServerIcon />,
    operations: <ShieldIcon />,
    incidents: <ShieldIcon />,
    audit: <ClockIcon />,
  };
  const pages = ADMIN_PAGES.map((p) => ({ ...p, to: `${home}${p.path}`, icon: ICONS[p.key], exact: p.path === "" }));
  const isCurrent = (p: (typeof pages)[number]) =>
    p.exact ? path === p.to : path === p.to || path.startsWith(`${p.to}/`);
  const current = pages.find(isCurrent) ?? pages[0]!;
  return (
    <AppShell.Root skipLabel={say("shell.skip")}>
      <AppShell.Sidebar
        label={say("adminConsole.shell.title")}
        brand={
          <Link href={home} className="inline-flex items-center gap-2">
            <YomizakaLogo size={24} animated={false} /> {PRODUCT_NAME}{" "}
            <Badge tone="warning">{say("adminConsole.shell.dev")}</Badge>
          </Link>
        }
        closeLabel={say("shell.closeMenu")}
        collapseLabels={[say("shell.collapse"), say("shell.expand")]}
        footer={
          <div className="flex flex-col gap-1 px-3 pb-2 text-xs text-fg-muted">
            <span className="truncate" title={email}>
              {say("shell.signedInAs", { email })}
            </span>
            {VERSION ? <span data-testid="app-version">{say("shell.devBuild", { version: VERSION })}</span> : null}
          </div>
        }
      >
        {ADMIN_GROUPS.map((group) => (
          <Fragment key={group.key}>
            <AppShell.Group>{say(`adminConsole.shell.groups.${group.key}`)}</AppShell.Group>
            {group.pages.map((g) => {
              const p = pages.find((x) => x.key === g.key)!;
              return (
                <AppShell.Item
                  key={p.key}
                  asChild
                  label={say(`adminConsole.shell.${p.key}`)}
                  icon={p.icon}
                  current={isCurrent(p)}
                >
                  <Link href={p.to}>{say(`adminConsole.shell.${p.key}`)}</Link>
                </AppShell.Item>
              );
            })}
          </Fragment>
        ))}
      </AppShell.Sidebar>
      <AppShell.Body>
        <AppShell.Header
          title={say(`adminConsole.shell.${current.key}`)}
          menuLabel={say("shell.openMenu")}
          actions={
            <>
              <LanguageSwitch
                label={say("shell.language")}
                current={locale}
                languages={languagesFor(`/${locale}${rest}`)}
                linkAs={Link}
              />
              <ThemeToggle label={say("shell.theme")} variant="ghost" />
              <Button size="sm" variant="secondary" loading={signOut.isPending} onClick={() => signOut.mutate()}>
                <LogoutIcon size={16} /> <span className="hidden sm:inline">{say("adminConsole.shell.signOut")}</span>
              </Button>
            </>
          }
        />
        <AppShell.Main>{children}</AppShell.Main>
      </AppShell.Body>
    </AppShell.Root>
  );
}
