"use client";

import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Chip } from "@krizaka/ui/chip";
import { List } from "@krizaka/ui/list";
import { SearchField } from "@krizaka/ui/search-field";
import Link from "next/link";
import { useState } from "react";

import { INTL } from "@/components/console/format";
import { type CatalogueItem, checkHref, chipsOf, planStrip, visibleItems } from "@/lib/check-catalogue";
import type { CreditsFigure } from "@/lib/home-b2";
import { useSay } from "@/lib/i18n-client";
import { CATALOGUE_FILTERS, ROUTE_STATES } from "@/lib/route-state";
import { useRouteState } from "@/lib/use-route-state";

/*
 * « Vérifier un document », B2 (verikora#333, design § 5.4): the plan strip, and the catalogue of the checks Verikora runs — a
 * search, chips with their counts, and a row each with « Disponible » and its one action, which names the kind and leads to the drop.
 * Waiting on krizaka-ui#711: `CataloguePage` has no « task column » beside the results (the drop, the run): the two columns are composed here
 * from `PlanStrip`, `Chip.Group`, `SearchField` and `List` until it has.
 */

/** Where the account stands: plan name, figures and a link to billing — one muted line at the foot of the check page. */
export function CheckPlanStrip({ credits }: Readonly<{ credits: CreditsFigure }>) {
  const { say, locale } = useSay();
  const plan = planStrip(credits);
  const parts = [
    say(`check.plan.names.${plan.plan}`),
    ...plan.figures.map((f) => {
      const formatted = new Intl.NumberFormat(INTL[locale]).format(f.value);
      const label = say(`check.plan.${f.id}`);
      return `${formatted} ${label}`;
    }),
    ...(plan.meter ? [say("check.plan.meterText", { used: plan.meter.value, cap: plan.meter.max })] : []),
  ];
  return (
    <p className="m-0 text-xs text-fg-muted" data-testid="plan-strip">
      {parts.join(" · ")}{" "}
      <Link href={`/${locale}/app/settings/facturation`} className="font-semibold text-fg-accent hover:underline">
        {say("check.plan.open")} →
      </Link>
    </p>
  );
}

/** The checks Verikora runs for this person: the registry's, narrowed by a search and a chip (the chip lives in the address, the search is ephemeral). */
export function CheckCatalogue({ items }: Readonly<{ items: readonly CatalogueItem[] }>) {
  const { say, locale } = useSay();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useRouteState(ROUTE_STATES.catalogueGroup.state);
  const [kind] = useRouteState(ROUTE_STATES.checkKind.state);
  const titleOf = (i: CatalogueItem) => say(`check.catalogue.items.${i.id}.title`);
  const chips = chipsOf(items, q, titleOf);
  const rows = visibleItems(items, { group: filter === "all" ? null : filter, q }, titleOf);
  const chosen = (i: CatalogueItem) => kind !== ROUTE_STATES.checkKind.state.fallback && i.kind === kind;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="catalogue-title" data-testid="check-catalogue">
      <h2 id="catalogue-title" className="m-0 font-display text-lg font-bold text-fg">
        {say("check.catalogue.title")}
      </h2>
      <SearchField
        label={say("check.catalogue.searchLabel")}
        placeholder={say("check.catalogue.searchPlaceholder")}
        value={q}
        onValueChange={setQ}
      />
      <Chip.Group
        type="single"
        required
        label={say("check.catalogue.groupsLabel")}
        value={filter}
        onValueChange={(v) => setFilter(v as (typeof CATALOGUE_FILTERS)[number])}
        routeKey={ROUTE_STATES.catalogueGroup.state.key}
        routeValues={CATALOGUE_FILTERS}
        data-testid="catalogue-chips"
      >
        {chips.map((c) => (
          <Chip key={c.group ?? "all"} value={c.group ?? "all"} size="sm">
            {c.group ? say(`check.catalogue.groups.${c.group}`) : say("check.catalogue.all")} ·{" "}
            <span className="tabular-nums">{c.count}</span>
          </Chip>
        ))}
      </Chip.Group>
      <List
        aria-label={say("check.catalogue.listLabel")}
        items={rows}
        getId={(i) => i.id}
        empty={<p className="m-0 p-4 text-sm text-fg-secondary">{say("check.catalogue.none")}</p>}
        row={(i) => ({
          title: titleOf(i),
          description: say(`check.catalogue.items.${i.id}.line`),
          meta: (
            <Badge tone="success" dot size="sm">
              {say("check.catalogue.available")}
            </Badge>
          ),
          actions: (
            <Button asChild variant={chosen(i) ? "primary" : "secondary"} size="sm">
              <Link
                href={checkHref(locale, i.kind)}
                aria-label={say("check.catalogue.actionFor", { title: titleOf(i) })}
                aria-current={chosen(i) ? "true" : undefined}
                scroll
              >
                {say("check.catalogue.action")}
              </Link>
            </Button>
          ),
        })}
      />
    </section>
  );
}
