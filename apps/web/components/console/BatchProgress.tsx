"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { PageHeader } from "@krizaka/ui/page-header";
import { Progress } from "@krizaka/ui/progress";
import Link from "next/link";
import { useMemo } from "react";

import { waitsForAccount, waitsForEngine } from "@/lib/batch/pausing";
import { checksTabHref } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

type ItemState = "pending" | "reused" | "running" | "done" | "failed" | "refused";
interface Item {
  id: string;
  line: number;
  file: string;
  reference: string | null;
  state: ItemState;
  error: string | null;
  documentId: string | null;
}
interface Batch {
  id: string;
  name: string;
  finishedAt: string | null;
  items: Item[];
  counts: Record<ItemState, number>;
  pausedBy: string | null;
}

const TONE: Record<ItemState, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  running: "accent",
  reused: "success",
  done: "success",
  failed: "danger",
  refused: "warning",
};
function itemColumns(say: Say, locale: Lang): DataTableColumn<Item>[] {
  return [
    { id: "line", header: say("batch.columns.line"), type: "number", value: (i) => i.line },
    {
      id: "file",
      header: say("batch.columns.file"),
      type: "title",
      card: "title",
      filter: "text",
      value: (i) => i.file,
      cell: (i) =>
        i.documentId ? (
          <Link
            className="break-all text-sm font-semibold text-fg-accent underline"
            href={`/${locale}/app/documents/${i.documentId}/rapport`}
          >
            {i.file}
          </Link>
        ) : (
          <span className="break-all text-sm">{i.file}</span>
        ),
    },
    {
      id: "state",
      header: say("batch.columns.state"),
      type: "status",
      filter: "facet",
      options: (Object.keys(TONE) as ItemState[]).map((s) => ({ value: s, label: say(`batch.states.${s}`) })),
      value: (i) => i.state,
      cell: (i) => <Badge tone={TONE[i.state]}>{say(`batch.states.${i.state}`)}</Badge>,
    },
    {
      id: "reason",
      header: say("batch.columns.reason"),
      value: (i) => i.error ?? "",
      cell: (i) =>
        i.error
          ? i.error
              .split(",")
              .map((e) => say(`errors.${e}`))
              .join(" · ")
          : "—",
    },
    { id: "reference", header: say("batch.columns.reference"), priority: 3, value: (i) => i.reference ?? "" },
  ];
}

/** While rows run, the page asks again; each read advances the batch on the server (no second scheduler). */
const POLL_MS = 3000;

/** A batch's page (verikora#232): how far it is, each row's state with its document, why a row did not run, the export. */
export function BatchProgress({ initial }: Readonly<{ initial: Batch }>) {
  const { say, locale } = useSay();
  const live = useQuery({
    queryKey: ["batch", initial.id],
    queryFn: async () => ((await krizakaFetch(`/api/batches/${initial.id}`)) as { batch: Batch }).batch,
    initialData: initial,
    refetchInterval: (q) =>
      q.state.data && !q.state.data.finishedAt && !waitsForAccount(q.state.data.pausedBy) ? POLL_MS : false,
  });
  const batch = live.data ?? initial;
  const total = batch.items.length - batch.counts.refused;
  const settled = batch.counts.done + batch.counts.reused + batch.counts.failed;

  const columns = useMemo(() => itemColumns(say, locale), [say, locale]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={
          <nav
            aria-label={say("checks.tabsLabel")}
            className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary"
          >
            <Link href={checksTabHref(locale, "checks")} className="hover:text-fg-accent hover:underline">
              {say("shell.checks")}
            </Link>
            <span aria-hidden>/</span>
            <Link href={checksTabHref(locale, "lots")} className="hover:text-fg-accent hover:underline">
              {say("checks.tabs.lots")}
            </Link>
          </nav>
        }
        title={batch.name}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/batches/${batch.id}/export`} download>
                {say("batch.export")}
              </a>
            </Button>
            {batch.counts.done + batch.counts.reused > 0 ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`/api/batches/${batch.id}/export?format=zip&lang=${locale}`} download>
                  {say("batch.exportZip")}
                </a>
              </Button>
            ) : null}
          </>
        }
      />
      <Card.Root className="flex flex-col gap-4 p-4">
        <Progress
          value={settled}
          max={Math.max(total, 1)}
          label={say("batch.progressLabel")}
          valueText={say("batch.progress", { settled, total })}
          showLabel
          status={waitsForAccount(batch.pausedBy) ? "paused" : undefined}
        />
        {waitsForAccount(batch.pausedBy) ? (
          <Alert tone="warning">
            {say(`errors.${batch.pausedBy}`)}{" "}
            <Link className="font-semibold underline" href={`/${locale}/app/settings/facturation`}>
              {say("batch.paused")}
            </Link>
          </Alert>
        ) : null}
        {waitsForEngine(batch.pausedBy) && !batch.finishedAt ? (
          <Alert tone="info">{say("batch.engineBusy")}</Alert>
        ) : null}
        {batch.finishedAt ? (
          <Alert tone="success">
            {say("batch.finished", {
              done: batch.counts.done + batch.counts.reused,
              failed: batch.counts.failed,
              refused: batch.counts.refused,
            })}
          </Alert>
        ) : null}
      </Card.Root>
      <DataTable
        caption={say("batch.rowsCaption")}
        rows={batch.items}
        columns={columns}
        getRowId={(i) => i.id}
        rowLabel={(i) => i.file}
        pageSize={12}
      />
    </div>
  );
}
