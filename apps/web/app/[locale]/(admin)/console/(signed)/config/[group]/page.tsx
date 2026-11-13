import { notFound } from "next/navigation";

import { PacksPanel, ScopeBar, SovkoraPanel } from "@/components/admin/ConfigPanels";
import { ConfigView } from "@/components/admin/ConfigView";
import { CouponsView } from "@/components/admin/CouponsView";
import { InvitationsView } from "@/components/admin/InvitationsView";
import { OrganisationPanel } from "@/components/admin/OrganisationPanel";
import { PriceCatalogueView } from "@/components/admin/PriceCatalogueView";
import { RefusedWordsView } from "@/components/admin/RefusedWordsView";
import { RouteTabs } from "@/components/RouteTabs";
import { appEnvironment } from "@/lib/env";
import { listAdminFlows } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";
import { CONFIG_PAGE, CONFIG_PAGES, isConfigPage, isSettingsGroup } from "@/lib/settings/admin-config";
import { SCOPE, type Scope } from "@/lib/settings/registry";

export const dynamic = "force-dynamic";

const SCOPES = Object.values(SCOPE) as string[];

/** One page of the app configuration, one route: /config/general | features | limits | plans | prices | coupons | invitations | words | packs | sovkora, at a scope given in the URL. */
export default async function ConfigPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string; group: string }>;
  searchParams: Promise<{ scope?: string; id?: string }>;
}>) {
  const { locale: raw, group } = await params;
  if (!isConfigPage(group)) notFound();
  const locale = asLocale(raw);
  const t = getDictionary(locale).console.adminConfig;
  const q = await searchParams;
  const scope = { scope: (q.scope && SCOPES.includes(q.scope) ? q.scope : SCOPE.global) as Scope, id: q.id ?? "" };
  const items = CONFIG_PAGES.map((p) => ({ value: p, label: t.groups[p] }));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 font-display text-xl font-bold text-fg">{t.title}</h1>
        <p className="m-0 mt-1 max-w-[70ch] text-sm text-fg-secondary">{t.lead}</p>
      </div>
      <RouteTabs base={`/${locale}/config`} label={t.title} items={items}>
        <div className="flex flex-col gap-6">
          {isSettingsGroup(group) ? <ScopeBar scope={scope} /> : null}
          {isSettingsGroup(group) ? <ConfigView group={group} scope={scope} /> : null}
          {group === CONFIG_PAGE.prices ? <PriceCatalogueView /> : null}
          {group === CONFIG_PAGE.coupons ? <CouponsView /> : null}
          {group === CONFIG_PAGE.invitations ? <InvitationsView /> : null}
          {group === CONFIG_PAGE.words ? <RefusedWordsView /> : null}
          {group === CONFIG_PAGE.packs ? (
            <PacksPanel flows={await listAdminFlows()} environment={appEnvironment()} />
          ) : null}
          {group === CONFIG_PAGE.organisation ? <OrganisationPanel /> : null}
          {group === CONFIG_PAGE.sovkora ? <SovkoraPanel /> : null}
        </div>
      </RouteTabs>
    </div>
  );
}
