"use client";

import { Badge } from "@krizaka/ui/badge";
import {
  DataTable,
  type DataTableColumn,
  DataTableFilters,
  type DataTableFilterState,
  type DataTableSort,
} from "@krizaka/ui/data-table";
import { useRouteState as useUrlState } from "@krizaka/ui/router";
import { DOCUMENT_KINDS, DOCUMENT_STATUSES, type DocumentSummary } from "@verikora/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";
import { PAGE_SIZES, pageOf, pageSizeOf, parseList, sortOf, sortParam, TABLE_DEFAULTS } from "@/lib/table-state";
import { KIND } from "@/lib/workspace/decl";

import { BulkActions } from "../organise/BulkActions";
import { formatBytes, formatDate } from "./format";
import { ItemMenu, type Option, type TagOption } from "./OrganisationActions";
import { RowBookmarks } from "./RowBookmarks";
import { tableLabels } from "./table-labels";
import { TagChips } from "./TagChips";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

function documentColumns(
  say: Say,
  locale: Lang,
  organise: Organise | undefined,
  bookmarks: Bookmarks | undefined,
): DataTableColumn<DocumentSummary>[] {
  return [
    {
      id: "title",
      header: say("library.columns.title"),
      sortable: true,
      filter: "text",
      type: "title",
      href: (d) => `/${locale}/app/documents/${d.id}`,
      card: "title",
      value: (d) => d.title,
      cell: (d) => (
        <span className="flex flex-col">
          <Link
            href={`/${locale}/app/documents/${d.id}`}
            className="font-semibold text-fg hover:text-fg-accent hover:underline"
            aria-label={say("library.open", { title: d.title })}
          >
            {d.title}
          </Link>
          <span className="text-xs text-fg-muted">
            {d.filename}
            {d.pages ? ` · ${say("library.pages", { count: d.pages })}` : ""}
            {!d.hasText ? ` · ${say("library.noText")}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "kind",
      header: say("library.columns.kind"),
      priority: DOCUMENT_COLUMN_PRIORITY.kind,
      sortable: true,
      filter: "facet",
      options: DOCUMENT_KINDS.map((k) => ({ value: k, label: say(`kinds.${k}`) })),
      value: (d) => d.kind,
      cell: (d) => say(`kinds.${d.kind}`),
    },
    {
      id: "status",
      header: say("library.columns.status"),
      type: "status",
      filter: "facet",
      options: DOCUMENT_STATUSES.map((k) => ({ value: k, label: say(`statuses.${k}`) })),
      value: (d) => d.status,
      cell: (d) => <Badge tone={STATUS_TONE[d.status]}>{say(`statuses.${d.status}`)}</Badge>,
    },
    {
      id: "size",
      header: say("library.columns.size"),
      priority: DOCUMENT_COLUMN_PRIORITY.size,
      sortable: true,
      align: "end",
      value: (d) => d.sizeBytes,
      cell: (d) => formatBytes(d.sizeBytes, locale),
    },
    {
      id: "added",
      header: say("library.columns.added"),
      priority: DOCUMENT_COLUMN_PRIORITY.added,
      sortable: true,
      align: "end",
      value: (d) => d.createdAt,
      cell: (d) => (
        <time dateTime={d.createdAt} className="whitespace-nowrap">
          {formatDate(d.createdAt, locale)}
        </time>
      ),
    },
    ...(bookmarks && !organise
      ? [
          {
            id: "bookmarks",
            header: say("documentsPage.bookmarks"),
            // A quick action sits in place: priority 2 keeps it on the phone card, one tap (3+ would send it under the chevron).
            priority: 2,
            value: (d: DocumentSummary) => (bookmarks.byDocument[d.id] ?? []).length,
            cell: (d: DocumentSummary) => (
              <RowBookmarks
                id={d.id}
                name={d.title}
                bookmarks={bookmarks.all}
                worn={(bookmarks.byDocument[d.id] ?? []).map((t) => t.id)}
              />
            ),
          } satisfies DataTableColumn<DocumentSummary>,
        ]
      : []),
    ...(organise
      ? [
          {
            id: "organise",
            header: say("organisation.title"),
            align: "end" as const,
            value: (d: DocumentSummary) => d.id,
            cell: (d: DocumentSummary) => (
              <span className="flex items-center justify-end gap-2">
                <TagChips tags={organise.tagsByDocument[d.id] ?? []} />
                <ItemMenu
                  kind="document"
                  id={d.id}
                  name={d.title}
                  collections={organise.collections}
                  folders={organise.folders}
                  collectionId={organise.collectionId}
                  tags={organise.tags}
                  current={(organise.tagsByDocument[d.id] ?? []).map((t) => t.id)}
                />
              </span>
            ),
          },
        ]
      : []),
  ];
}

/** The person's bookmarks on documents, and the ones each document wears: the column's chips and its one-tap menu. */
export interface Bookmarks {
  all: TagOption[];
  byDocument: Record<string, TagOption[]>;
}

/** What the row menu needs to move and tag a document: the destinations, the owner's tags and each document's own. */
export interface Organise {
  collections: Option[];
  folders: Option[];
  collectionId: string | null;
  tags: TagOption[];
  tagsByDocument: Record<string, TagOption[]>;
}

// @fixed: the ceiling of one bulk call in @krizaka/organize (krizaka-ts ADR-003); the bar says so past it.
const BULK_MAX = 200;

/** The columns the table sorts by (and the address may name). */
const SORTABLE = ["title", "kind", "size", "added"] as const;

export const STATUS_TONE = {
  stored: "neutral",
  analysing: "accent",
  checked: "success",
  attention: "warning",
  failed: "danger",
} as const;

/** Which columns a phone's list row keeps (P12): 1 always (the title, the result); 2 joined as the one line of facts (« Bail · 23 oct. »); 3 leaves for the row's detail. */
export const DOCUMENT_COLUMN_PRIORITY = { title: 1, kind: 2, status: 1, size: 3, added: 2 } as const;

/** The bulk bar's actions: bookmark (or lift) the selected documents, the result said by the table. */
const bulkActionsOf = (tags: Bookmarks["all"], onResult: (message: string) => void) =>
  function BulkSlot({ selected: ids, clear }: { selected: string[]; clear: () => void }) {
    return (
      <BulkActions
        kind={KIND.document}
        ids={ids}
        tags={tags}
        words="documentsPage"
        onResult={onResult}
        onDone={clear}
      />
    );
  };

/** The documents of a view (rows come from the server; a run in progress refreshes them every 4 s). */
export function DocumentTable({
  rows,
  caption,
  organise,
  bookmarks,
}: Readonly<{ rows: DocumentSummary[]; caption?: string; organise?: Organise; bookmarks?: Bookmarks }>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const running = rows.some((d) => d.status === "analysing");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [running, router]);
  const columns = useMemo(() => documentColumns(say, locale, organise, bookmarks), [say, locale, organise, bookmarks]);
  // The state is the address: ?q= (search in the title) &kind= &status= (filters) &page= &size= &sort= — a refresh, a shared link and the back button restore it.
  const [q, setQ] = useUrlState<string>("q", { default: TABLE_DEFAULTS.q, history: "replace" });
  const [kind, setKind] = useUrlState<string>("kind", { default: "" });
  const [status, setStatus] = useUrlState<string>("status", { default: "" });
  const [page, setPage] = useUrlState<string>("page", { default: TABLE_DEFAULTS.page });
  const [size, setSize] = useUrlState<string>("size", { values: PAGE_SIZES.map(String), default: TABLE_DEFAULTS.size });
  const [sortRaw, setSort] = useUrlState<string>("sort", { default: TABLE_DEFAULTS.sort });
  const filters: DataTableFilterState = Object.fromEntries(
    [
      q ? (["title", q] as const) : null,
      kind ? (["kind", parseList(kind, DOCUMENT_KINDS)] as const) : null,
      status ? (["status", parseList(status, DOCUMENT_STATUSES)] as const) : null,
    ].filter((e) => e !== null),
  );
  const onFiltersChange = (next: DataTableFilterState) => {
    setQ(typeof next.title === "string" ? next.title : "");
    setKind(Array.isArray(next.kind) ? next.kind.join(",") : "");
    setStatus(Array.isArray(next.status) ? next.status.join(",") : "");
    setPage(TABLE_DEFAULTS.page);
  };
  // Bookmarks in bulk (verikora#339): select documents, apply or lift a bookmark on all of them in one call (the table's bar, count and ceiling are Krizaka UI's).
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkResult, setBulkResult] = useState("");
  const labels = useMemo(
    () => ({
      ...tableLabels(say),
      selection: {
        bar: say("documentsPage.bulk.label"),
        selected: (count: number) => say(pluralKey("documentsPage.bulk.selected", count), { count }),
        clear: say("documentsPage.bulk.clear"),
        tooMany: (max: number) => say("documentsPage.bulk.tooMany", { max }),
      },
    }),
    [say],
  );
  const bulk = bookmarks
    ? {
        selectable: true as const,
        selected,
        onSelectedChange: setSelected,
        bulkMax: BULK_MAX,
        bulkResult,
        bulkActions: bulkActionsOf(bookmarks.all, setBulkResult),
      }
    : {};
  const sort = sortOf(sortRaw, SORTABLE);
  return (
    <DataTable
      caption={caption ?? say("library.caption")}
      rows={rows}
      columns={columns}
      getRowId={(d) => d.id}
      rowLabel={(d) => d.title}
      sort={sort}
      onSortChange={(next: DataTableSort) => setSort(sortParam(next))}
      filters={filters}
      onFiltersChange={onFiltersChange}
      page={pageOf(page)}
      onPageChange={(n) => setPage(String(n))}
      pageSize={pageSizeOf(size)}
      pageSizeOptions={PAGE_SIZES}
      onPageSizeChange={(n) => {
        setSize(String(n));
        setPage(TABLE_DEFAULTS.page);
      }}
      toolbar={<DataTableFilters />}
      labels={labels}
      phone="list"
      {...bulk}
    />
  );
}
