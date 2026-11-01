"use client";

import { formatDate } from "@krizaka/intl";
import type { SavedView, StatusSet, SystemView, ViewFilters } from "@krizaka/organize/contract";
import { viewHref } from "@krizaka/organize/contract";
import { Button } from "@krizaka/ui/button";
import { ChipLink } from "@krizaka/ui/chip-link";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { EmptyState } from "@krizaka/ui/empty-state";
import { type ActiveFilter, FilterBar, FilterMenu } from "@krizaka/ui/filter-bar";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import { StatusChip } from "@krizaka/ui/status-chip";
import { Tabs } from "@krizaka/ui/tabs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { FileSummary } from "@/lib/applicant-file";
import { documentsFact, linkFact } from "@/lib/applicant-file-face";
import type { LinkState } from "@/lib/applicant-file-rules";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { filesInStates } from "@/lib/home-figures";
import { useSay } from "@/lib/i18n-client";
import { controlsShown } from "@/lib/library-screen";
import { pluralKey } from "@/lib/plural";
import type { binderPlan } from "@/lib/workspace/binder";
import { KIND, OWNER_ROLE } from "@/lib/workspace/decl";
import { decisionOrder } from "@/lib/workspace/order";
import type { ResolvedView } from "@/lib/workspace/view";

import { BulkActions } from "../organise/BulkActions";
import { useSavedViews } from "../organise/useSavedViews";
import { DISPLAY_TIME_ZONE, INTL } from "./format";
import { type AskableType, RequestDocuments } from "./RequestDocuments";
import { tableLabels } from "./table-labels";
import { TagChips } from "./TagChips";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

type TagOption = { id: string; name: string; color: "blue" | "green" | "amber" | "red" | "violet" | "gray" };

/** What the organised workspace gives « Dossiers » (yomizaka#324): the decision set, the account's tags, the views and the one the address names. */
export interface FilesWorkspace {
  set: StatusSet;
  tags: readonly TagOption[];
  system: readonly SystemView[];
  saved: readonly SavedView[];
  resolved: ResolvedView;
  /** The binder: a tab per decision state and a chip per tag (`binderPlan`), and the number of files each view holds, in the plan's order. */
  plan: ReturnType<typeof binderPlan>;
  counts: { tabs: readonly number[]; chips: readonly number[] };
}

// @fixed: the ceiling of one bulk call in @krizaka/organize (krizaka-ts ADR-003); the bar says so past it.
const BULK_MAX = 200;

const NO_VIEW: ResolvedView = { active: null, filters: {}, modified: false };

/** The words of a file's link and documents, shared by the list and the detail. */
export function useFileFacts() {
  const { say, locale } = useSay();
  const date = (iso: string) => formatDate(iso, { locale: INTL[locale], timeZone: DISPLAY_TIME_ZONE });
  return {
    link: (f: Parameters<typeof linkFact>[0]) => {
      const fact = linkFact(f);
      return say(fact.key, fact.date ? { date: date(fact.date) } : undefined);
    },
    documents: (count: number, asked: number) => {
      const fact = documentsFact(count, asked);
      return say(fact.key, { count: fact.count, asked: fact.asked });
    },
    date,
  };
}
// The link's state is a priority-1 column: on a phone the list puts it in the row's detail, whole. At priority 2 it became the one-line
// « facts » under the name, truncated beside the decision chip and the toggle, and the layout audit saw it cut off (yomizaka#496).
function fileColumns(
  say: Say,
  base: string,
  facts: ReturnType<typeof useFileFacts>,
  workspace: FilesWorkspace | undefined,
  locale: Lang,
): DataTableColumn<FileSummary>[] {
  return [
    {
      id: "candidate",
      header: say("dossiers.columns.candidate"),
      type: "title",
      href: (f) => `${base}/${f.id}`,
      card: "title",
      value: (f) => f.candidateName,
      cell: (f) => (
        <Link
          href={`${base}/${f.id}`}
          className="font-semibold text-fg hover:text-fg-accent hover:underline"
          aria-label={say("dossiers.open", { name: f.candidateName })}
        >
          {f.candidateName}
        </Link>
      ),
    },
    {
      id: "link",
      header: say("dossiers.columns.link"),
      value: (f) => f.status,
      cell: (f) => <span data-testid="file-link">{facts.link(f)}</span>,
    },
    ...(workspace
      ? [
          {
            id: "decision",
            header: say("dossiers.columns.decision"),
            type: "status" as const,
            sortable: true,
            // The set's order, never a check's result (krizaka-ts ADR-003 § 2).
            value: (f: FileSummary) => decisionOrder(workspace.set, f.decision),
            cell: (f: FileSummary) => (
              <StatusChip set={workspace.set} state={f.decision} role={OWNER_ROLE} locale={locale} />
            ),
          } satisfies DataTableColumn<FileSummary>,
        ]
      : []),
    {
      id: "documents",
      header: say("dossiers.columns.documents"),
      priority: 3,
      value: (f) => f.documents,
      cell: (f) => <span className="tabular-nums">{facts.documents(f.documents, f.requested)}</span>,
    },
    ...(workspace
      ? [
          {
            id: "tags",
            header: say("dossiers.columns.tags"),
            priority: 3,
            value: (f: FileSummary) => f.tagIds.length,
            cell: (f: FileSummary) => <TagChips tags={workspace.tags.filter((t) => f.tagIds.includes(t.id))} />,
          } satisfies DataTableColumn<FileSummary>,
        ]
      : []),
    {
      id: "asked",
      header: say("dossiers.columns.asked"),
      priority: 3,
      align: "end",
      value: (f) => f.createdAt,
      cell: (f) => <span className="tabular-nums">{facts.date(f.createdAt)}</span>,
    },
  ];
}

/**
 * « Dossiers » (design § 4, § 5.2, yomizaka#323, #324): the applicant files, newest first, as `listApplicantFiles` returns them —
 * the applicant, the link's state as a line of facts, **your decision** (the set's chip, sorted by the set's order — never by a check's
 * result), the documents in against those asked, the tags with their markers, the day it was asked — the views, the filters of the
 * address, the selection bar and « Demander des documents ».
 */
export function FilesView({
  files: all,
  states = [],
  types,
  origin,
  workspace,
}: Readonly<{
  files: readonly FileSummary[];
  states?: readonly LinkState[];
  types: readonly AskableType[];
  origin: string;
  workspace?: FilesWorkspace;
}>) {
  // The link-state filter of the address (`?state=used`), the door of the home's « À traiter » (yomizaka#325).
  const files = filesInStates(all, states);
  const { say, locale } = useSay();
  const facts = useFileFacts();
  const base = `/${locale}${CONSOLE_ROUTES.files}`;
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkResult, setBulkResult] = useState("");
  const filters: ViewFilters = workspace?.resolved.filters ?? {};
  const go = (next: ViewFilters) =>
    router.push(viewHref(base, next, workspace?.resolved.active?.id ?? null), { scroll: false });
  const views = useSavedViews({
    path: base,
    system: (workspace?.system ?? []).filter((v) => (v.filters.status?.length ?? 0) !== 1 || !!v.filters.tags?.length),
    mine: workspace?.saved ?? [],
    resolved: workspace?.resolved ?? NO_VIEW,
    kind: KIND.applicantFile,
  });
  const decisionLabel = (key: string) => workspace?.set.states.find((st) => st.key === key)?.label[locale] ?? key;
  const columns = useMemo(
    () => fileColumns(say, base, facts, workspace, locale),
    [say, base, facts, workspace, locale],
  );
  const labels = useMemo(
    () => ({
      ...tableLabels(say),
      selection: {
        bar: say("dossiers.bulk.label"),
        selected: (count: number) => say(pluralKey("dossiers.bulk.selected", count), { count }),
        clear: say("dossiers.bulk.clear"),
        tooMany: (max: number) => say("dossiers.bulk.tooMany", { max }),
      },
    }),
    [say],
  );
  // Tabs, filters and the count only once there is something to filter (krizaka-internal#1902).
  const controls = controlsShown({ total: all.length, filtering: hasActiveFilter(filters) || states.length > 0 });
  const ask = (variant: "primary" | "secondary") => (
    <RequestDocuments
      types={types}
      origin={origin}
      trigger={
        <Button variant={variant} size="md">
          {say("dossiers.request")}
        </Button>
      }
    />
  );
  return (
    <div className="flex flex-col gap-6" data-testid="files-view">
      <PageHeader
        title={say("dossiers.title")}
        description={say("dossiers.lead")}
        actions={all.length ? ask("secondary") : null}
      />
      {workspace && controls ? <Binder workspace={workspace} base={base} /> : null}
      {workspace && controls ? (
        <FilterBar
          label={say("dossiers.filters.bar")}
          active={activeFilters(filters, workspace.tags, decisionLabel, go)}
          onClearAll={() => go({})}
          clearLabel={say("dossiers.filters.clear")}
          removeLabel={(label) => say("dossiers.filters.remove", { label })}
          results={say(pluralKey("dossiers.filters.results", all.length), { count: all.length })}
          views={views}
          data-testid="files-filters"
        >
          {workspace.tags.length ? (
            <FilterMenu
              label={say("dossiers.filters.tags")}
              options={workspace.tags.map((t) => ({ value: t.id, label: t.name }))}
              value={filters.tags ?? []}
              onValueChange={(tags) => go({ ...filters, tags })}
            />
          ) : null}
          <FilterMenu
            label={say("dossiers.filters.decision")}
            options={workspace.set.states.map((st) => ({ value: st.key, label: st.label[locale] }))}
            value={filters.status ?? []}
            onValueChange={(status) => go({ ...filters, status })}
          />
        </FilterBar>
      ) : null}
      {states.length ? (
        <p className="m-0 text-sm text-fg-secondary" data-testid="files-filter">
          {say("dossiers.filter.label")} · {states.map((st) => say(`dossiers.filter.states.${st}`)).join(", ")} ·{" "}
          <Link href={base} className="font-semibold text-fg-accent hover:underline">
            {say("dossiers.filter.clear")}
          </Link>
        </p>
      ) : null}
      <FilesBody
        files={files}
        states={states}
        filtered={Boolean(workspace) && hasActiveFilter(filters)}
        columns={columns}
        labels={labels}
        table={
          workspace
            ? { workspace, selected, onSelectedChange: setSelected, bulkResult, onBulkResult: setBulkResult }
            : null
        }
        empty={
          <EmptyState
            icon={<Mascot bird="owl" mood="empty" size={120} />}
            title={say("dossiers.empty.title")}
            description={say("dossiers.empty.text")}
            action={ask("primary")}
            data-testid="files-empty"
          />
        }
      />
    </div>
  );
}

const hasActiveFilter = (filters: ViewFilters) =>
  Object.values(filters).some((v) => (Array.isArray(v) ? v.length : !!v));

/** The chips of the filter bar: a removable one per tag and per decision state in the address. */
function activeFilters(
  filters: ViewFilters,
  tags: readonly TagOption[],
  decisionLabel: (key: string) => string,
  go: (next: ViewFilters) => void,
): ActiveFilter[] {
  const byTag = (filters.tags ?? []).flatMap((id): ActiveFilter[] => {
    const tag = tags.find((t) => t.id === id);
    return tag
      ? [
          {
            id: `tag:${id}`,
            label: tag.name,
            onRemove: () => go({ ...filters, tags: (filters.tags ?? []).filter((x) => x !== id) }),
          },
        ]
      : [];
  });
  const byStatus = (filters.status ?? []).map((key): ActiveFilter => ({
    id: `status:${key}`,
    label: decisionLabel(key),
    onRemove: () => go({ ...filters, status: (filters.status ?? []).filter((x) => x !== key) }),
  }));
  return [...byTag, ...byStatus];
}

type TableSelection = {
  workspace: FilesWorkspace;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  bulkResult: string;
  onBulkResult: (message: string) => void;
};

/** The selection bar's actions for the dossiers, bound to the table's workspace and to where the outcome is said. */
function bulkActionsOf(table: TableSelection) {
  return function FileBulkActions({ selected: ids, clear }: { selected: string[]; clear: () => void }) {
    return (
      <BulkActions
        kind={KIND.applicantFile}
        ids={ids}
        set={table.workspace.set}
        tags={table.workspace.tags}
        onResult={table.onBulkResult}
        onDone={clear}
      />
    );
  };
}

/** What sits under the filters: why nothing is listed, the table (selectable in a workspace), or the empty state. */
function FilesBody({
  files,
  states,
  filtered,
  columns,
  labels,
  table,
  empty,
}: Readonly<{
  files: readonly FileSummary[];
  states: readonly LinkState[];
  filtered: boolean;
  columns: DataTableColumn<FileSummary>[];
  labels: ReturnType<typeof tableLabels>;
  table: TableSelection | null;
  empty: React.ReactNode;
}>) {
  const { say } = useSay();
  if (!files.length && states.length)
    return <p className="m-0 text-sm text-fg-secondary">{say("dossiers.filter.none")}</p>;
  if (!files.length && filtered) {
    return (
      <p className="m-0 text-sm text-fg-secondary" data-testid="files-nothing">
        {say("dossiers.filters.nothing")}
      </p>
    );
  }
  if (!files.length) return <>{empty}</>;
  return (
    <DataTable
      caption={say("dossiers.caption")}
      rows={[...files]}
      columns={columns}
      getRowId={(f) => f.id}
      rowLabel={(f) => f.candidateName}
      pageSize={12}
      labels={labels}
      phone="list"
      {...(table
        ? {
            selectable: true,
            selected: table.selected,
            onSelectedChange: table.onSelectedChange,
            bulkMax: BULK_MAX,
            bulkResult: table.bulkResult,
            bulkActions: bulkActionsOf(table),
          }
        : {})}
    />
  );
}

/**
 * The binder (design B2, yomizaka#334): the decision states as binder tabs with their counts, the tags as chips with theirs. Every
 * one is a link, the address is the state; each count is the length of the view it opens (`countApplicantFiles`, the list's filter).
 */
function Binder({ workspace, base }: Readonly<{ workspace: FilesWorkspace; base: string }>) {
  const { say, locale } = useSay();
  const { plan, counts } = workspace;
  // `Tabs.Nav` marks a tab active when the link's parameters are in the route: « Tous » is `status=` (none), a state `status=<key>`.
  const current = `${base}?status=${plan.activeState === null ? "" : plan.activeState}`;
  return (
    <div className="flex flex-col gap-3" data-testid="binder">
      <Tabs.Nav label={say("dossiers.binder.label")} current={current} variant="binder">
        {plan.tabs.map((tab, i) => (
          <Tabs.NavLink key={tab.state ?? "all"} href={`${base}?status=${tab.state ?? ""}`} hue={tab.hue} asChild>
            <Link href={viewHref(base, tab.filters, null)} scroll={false}>
              {tab.label ? tab.label[locale] : say("dossiers.binder.all")}{" "}
              <span className="tabular-nums" data-testid="binder-count">
                {counts.tabs[i] ?? 0}
              </span>
            </Link>
          </Tabs.NavLink>
        ))}
      </Tabs.Nav>
      {plan.chips.length ? (
        <nav aria-label={say("dossiers.binder.tags")} className="flex flex-wrap items-center gap-2">
          {plan.chips.map((chip, i) => {
            const tag = workspace.tags.find((t) => t.id === chip.id);
            return tag ? (
              <ChipLink key={chip.id} asChild size="sm" selected={chip.on}>
                <Link href={viewHref(base, chip.filters, null)} scroll={false}>
                  {tag.name} <span className="tabular-nums">{counts.chips[i] ?? 0}</span>
                </Link>
              </ChipLink>
            ) : null;
          })}
        </nav>
      ) : null}
    </div>
  );
}
