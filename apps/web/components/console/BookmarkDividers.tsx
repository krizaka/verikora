"use client";

import { Tabs } from "@krizaka/ui/tabs";
import Link from "next/link";

import { useSay } from "@/lib/i18n-client";
import type { Divider } from "@/lib/organisation/bookmarks";

/**
 * The bookmarks as the binder's dividers over the documents (verikora#339): « All » and a tab per bookmark with its count. Each tab is a link,
 * the address is the state (`?tags=`); the filter bar below stays the way to combine several.
 */
export function BookmarkDividers({ tabs, path }: Readonly<{ tabs: readonly Divider[]; path: string }>) {
  const { say } = useSay();
  const active = tabs.find((t) => t.on);
  return (
    <Tabs.Nav
      label={say("documentsPage.dividers")}
      current={active?.id ? `${path}?tags=${active.id}` : path}
      variant="binder"
      data-testid="bookmark-dividers"
    >
      {tabs.map((tab) => (
        <Tabs.NavLink key={tab.id ?? "all"} href={tab.href} hue={tab.hue} asChild>
          <Link href={tab.href} scroll={false}>
            {tab.name ?? say("documentsPage.allBookmarks")} <span className="tabular-nums">{tab.count}</span>
          </Link>
        </Tabs.NavLink>
      ))}
    </Tabs.Nav>
  );
}
