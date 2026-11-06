"use client";

import { Badge } from "@krizaka/ui/badge";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { EmptyState } from "@krizaka/ui/empty-state";
import { type ActiveFilter, FilterBar, FilterMenu } from "@krizaka/ui/filter-bar";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import { SearchField } from "@krizaka/ui/search-field";
import { Tabs } from "@krizaka/ui/tabs";
import { DOCUMENT_KINDS, type DocumentKind, type DocumentStatus } from "@verikora/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ButtonLink } from "@/components/ButtonLink";
import {
  applyCheckFilters,
  CHECK_PERIODS,
  CHECK_RESULTS,
  type CheckFilters,
  type CheckPeriod,
  countByPeriod,
  countByValue,
  type DraftState,
  FILTER_HISTORY,
  type FilterHistory,
  NO_CHECK_FILTERS,
  readCheckFilters,
  reconcileDraft,
  writeCheckFilters,
} from "@/lib/check-filters";
import type { CheckSummary } from "@/lib/checks";
import { runningChecks } from "@/lib/checks-live";
import { CHECKS_TAB_KEY, CHECKS_TABS, checksTabHref, checksTabOf, CONSOLE_ROUTES } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { BatchImport } from "./BatchImport";
import { STATUS_TONE } from "./DocumentTable";
import { formatDate } from "./format";
import { RunId } from "./RunId";
import { tableLabels } from "./table-labels";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

function checkColumns(say: Say, locale: Lang): DataTableColumn<CheckSummary>[] {
  return [
    {
      id: "title",
      header: say("checks.columns.document"),
      type: "title",
      href: (c) => `/${locale}/app/documents/${c.documentId}/rapport`,
      card: "title",
      value: (c) => c.title,
      cell: (c) => (
        <Link
          href={`/${locale}/app/documents/${c.documentId}/rapport`}
          className="font-semibold text-fg hover:text-fg-accent hover:underline"
          aria-label={say("library.open", { title: c.title })}
        >
          {c.title}
        </Link>
      ),
    },
    {
      id: "kind",
      header: say("checks.columns.kind"),
      priority: 2,
      value: (c) => c.kind,
      cell: (c) => say(`kinds.${c.kind}`),
    },
    {
      id: "studio",
      header: say("checks.columns.check"),
      priority: 3,
      value: (c) => c.studio,
      cell: (c) => say(`batch.studios.${c.studio}`),
    },
    {
      id: "result",
      header: say("checks.columns.result"),
      type: "status",
      value: (c) => c.result,
      cell: (c) => <Badge tone={STATUS_TONE[c.result]}>{say(`statuses.${c.result}`)}</Badge>,
    },
    {
      id: "at",
      header: say("checks.columns.when"),
      priority: 2,
      align: "end",
      value: (c) => c.at,
      cell: (c) => <span className="whitespace-nowrap">{formatDate(c.at, locale)}</span>,
    },
    {
      id: "run",
      header: say("checks.columns.run"),
      priority: 3,
      value: (c) => c.runId ?? "",
      cell: (c) => <RunId id={c.runId} />,
    },
  ];
}

/** The checks, one row each: the document (a link to its report), what ran, the result, when, the run. A phone's list row (P12): the title, one line of facts (the kind and the day), the result. */
function ChecksTable({ rows }: Readonly<{ rows: CheckSummary[] }>) {
  const { say, locale } = useSay();
  const columns = useMemo(() => checkColumns(say, locale), [say, locale]);
  const labels = useMemo(() => tableLabels(say), [say]);
  return (
    <DataTable
      caption={say("checks.caption")}
      rows={rows}
      columns={columns}
      getRowId={(c) => c.id}
      rowLabel={(c) => c.title}
      pageSize={12}
      labels={labels}
      phone="list"
    />
  );
}

/**
 * The filters of the list (the UX review's Y6): the search, the result, the kind and the period as menus with their counts, the ones
 * in force as removable chips, the count of results — every one in the address, so a filtered list is a link and back undoes a filter.
 */
function ChecksFilters({
  filters,
  counts,
  periods,
  results,
  onChange,
}: Readonly<{
  filters: CheckFilters;
  counts: { result: Record<string, number>; kind: Record<string, number> };
  periods: Record<CheckPeriod, number>;
  results: number;
  onChange: (next: CheckFilters, history: FilterHistory) => void;
}>) {
  const { say } = useSay();
  // What is typed, until the address carries it: the field never jumps back while the words travel, and follows the address when it changes elsewhere.
  const [state, setState] = useState<DraftState>({ draft: null, pending: filters.q, seen: filters.q });
  const reconciled = reconcileDraft(state, filters.q);
  if (reconciled !== state) setState(reconciled);
  const q = reconciled.draft ?? filters.q;
  const set = (patch: Partial<CheckFilters>) => onChange({ ...filters, ...patch }, FILTER_HISTORY.chosen);
  const commit = (value: string, history: FilterHistory) => {
    setState((s) => ({ ...s, pending: value }));
    onChange({ ...filters, q: value }, history);
  };
  const clear = () => {
    setState((s) => ({ ...s, draft: null, pending: "" }));
    onChange(NO_CHECK_FILTERS, FILTER_HISTORY.chosen);
  };
  const labelled = (field: string, value: string) => `${say(field)} : ${value}`;
  const active: ActiveFilter[] = [
    ...(filters.q
      ? [
          {
            id: "q",
            label: `${say("checks.filters.search")} : ${filters.q}`,
            onRemove: () => commit("", FILTER_HISTORY.chosen),
          },
        ]
      : []),
    ...filters.result.map((v) => ({
      id: `result:${v}`,
      label: labelled("checks.filters.result", say(`statuses.${v}`)),
      onRemove: () => set({ result: filters.result.filter((r) => r !== v) }),
    })),
    ...filters.kind.map((v) => ({
      id: `kind:${v}`,
      label: labelled("checks.filters.kind", say(`kinds.${v}`)),
      onRemove: () => set({ kind: filters.kind.filter((k) => k !== v) }),
    })),
    ...(filters.period
      ? [
          {
            id: "period",
            label: labelled("checks.filters.period", say(`checks.filters.periods.${filters.period}`)),
            onRemove: () => set({ period: null }),
          },
        ]
      : []),
  ];
  return (
    <FilterBar
      label={say("checks.filters.label")}
      active={active}
      onClearAll={clear}
      clearLabel={say("checks.filters.clear")}
      removeLabel={(label) => say("checks.filters.remove", { label })}
      results={say(pluralKey("checks.results", results), { count: results })}
      data-testid="checks-filters"
    >
      <SearchField
        size="sm"
        label={say("checks.filters.search")}
        placeholder={say("checks.filters.search")}
        clearLabel={say("checks.filters.clearSearch")}
        value={q}
        onValueChange={(v) => setState((s) => ({ ...s, draft: v }))}
        onSearch={(v) => commit(v, FILTER_HISTORY.typed)}
        onSubmit={(v) => commit(v, FILTER_HISTORY.chosen)}
        landmark={false}
      />
      <FilterMenu
        label={say("checks.filters.result")}
        options={CHECK_RESULTS.map((v) => ({ value: v, label: say(`statuses.${v}`), count: counts.result[v] ?? 0 }))}
        value={filters.result}
        onValueChange={(v) => set({ result: v as DocumentStatus[] })}
      />
      <FilterMenu
        label={say("checks.filters.kind")}
        options={DOCUMENT_KINDS.map((v) => ({ value: v, label: say(`kinds.${v}`), count: counts.kind[v] ?? 0 }))}
        value={filters.kind}
        onValueChange={(v) => set({ kind: v as DocumentKind[] })}
      />
      <FilterMenu
        label={say("checks.filters.period")}
        multiple={false}
        options={CHECK_PERIODS.map((p) => ({ value: p, label: say(`checks.filters.periods.${p}`), count: periods[p] }))}
        value={filters.period ?? ""}
        onValueChange={(v) => set({ period: CHECK_PERIODS.find((p) => p === v) ?? null })}
      />
    </FilterBar>
  );
}

/**
 * The Vérifications destination (the UX review's § 4.1): the list of every check under its filters, « Lots » as a second tab in the
 * address (`?tab=lots`, where the batches live), and — with nothing checked yet — the owl and the one action, « Vérifier un document ».
 * `now` comes from the server, so the periods read the same on both sides.
 */
export function ChecksView({
  checks,
  batches,
  now,
}: Readonly<{ checks: CheckSummary[]; batches: boolean; now: string }>) {
  const { say, locale } = useSay();
  const path = usePathname() ?? `/${locale}${CONSOLE_ROUTES.checks}`;
  const search = useSearchParams();
  const router = useRouter();
  const params = useMemo(() => new URLSearchParams(search?.toString() ?? ""), [search]);
  const tab = batches ? checksTabOf(params.get(CHECKS_TAB_KEY)) : CHECKS_TABS[0];
  const filters = useMemo(() => readCheckFilters(params), [params]);
  const at = useMemo(() => new Date(now), [now]);
  const rows = useMemo(() => applyCheckFilters(checks, filters, at), [checks, filters, at]);
  const counts = useMemo(
    () => ({ result: countByValue(checks, filters, "result", at), kind: countByValue(checks, filters, "kind", at) }),
    [checks, filters, at],
  );
  const periods = useMemo(() => countByPeriod(checks, filters, at), [checks, filters, at]);
  const hrefWith = (next: CheckFilters) => {
    const qs = writeCheckFilters(params, next).toString();
    return qs ? `${path}?${qs}` : path;
  };
  // While a check runs the list asks again every 4 s (the page refreshes it from Sovkora), as the documents table does.
  const live = runningChecks(checks).length > 0;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [live, router]);
  // Each tab names itself for the match (`?tab=checks` · `?tab=lots`); the first one's real link keeps the address clean.
  const current = `${path}?${CHECKS_TAB_KEY}=${tab}`;
  const list = rows.length ? (
    <ChecksTable rows={rows} />
  ) : (
    <EmptyState
      title={say("checks.noMatch.title")}
      description={say("checks.noMatch.text")}
      action={
        <ButtonLink href={hrefWith(NO_CHECK_FILTERS)} variant="secondary" size="md">
          {say("checks.filters.clear")}
        </ButtonLink>
      }
      data-testid="checks-no-match"
    />
  );
  return (
    <div className="flex flex-col gap-6" data-live={live || undefined}>
      <PageHeader
        title={say("checks.title")}
        description={say("checks.lead")}
        actions={
          batches && tab !== "lots" ? (
            <ButtonLink href={checksTabHref(locale, "lots")} variant="secondary" size="md">
              {say("checks.import")}
            </ButtonLink>
          ) : null
        }
      />
      {batches ? (
        <Tabs.Nav label={say("checks.tabsLabel")} current={current}>
          {CHECKS_TABS.map((t) => (
            <Tabs.NavLink key={t} href={`${path}?${CHECKS_TAB_KEY}=${t}`} exact asChild>
              <Link href={checksTabHref(locale, t)} scroll={false}>
                {say(`checks.tabs.${t}`)}
              </Link>
            </Tabs.NavLink>
          ))}
        </Tabs.Nav>
      ) : null}
      {tab === "lots" ? <BatchImport /> : null}
      {tab !== "lots" && checks.length ? (
        <>
          <ChecksFilters
            filters={filters}
            counts={counts}
            periods={periods}
            results={rows.length}
            onChange={(next, history) => router[history](hrefWith(next), { scroll: false })}
          />
          {list}
        </>
      ) : null}
      {tab !== "lots" && !checks.length ? (
        <EmptyState
          icon={<Mascot bird="owl" mood="empty" size={120} />}
          title={say("checks.empty.title")}
          description={say("checks.empty.text")}
          action={
            <ButtonLink href={`/${locale}${CONSOLE_ROUTES.check}`} variant="primary" size="md" shape="cut">
              {say("shell.checkAction")}
            </ButtonLink>
          }
          data-testid="checks-empty"
        />
      ) : null}
    </div>
  );
}
