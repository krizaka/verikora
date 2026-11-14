"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import type { AdminAuditEntry, AdminDocument, AdminRun } from "@/lib/admin";
import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";

import { formatBytes, formatDate } from "../console/format";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

const RUN_TONE: Record<string, "accent" | "success" | "danger" | "neutral"> = {
  running: "accent",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
};

/** An administrator's on/off flag on a row (a sample document, the showcase check): POST sets it, DELETE takes it away. */
function FlagButton({
  url,
  on,
  labels,
  disabled,
}: Readonly<{
  url: string;
  on: boolean;
  labels: { on: string; off: string; set: string; unset: string };
  disabled?: boolean;
}>) {
  const { say } = useSay();
  const router = useRouter();
  const change = useMutation({
    mutationFn: () => krizakaFetch(url, { method: on ? "DELETE" : "POST" }),
    onSuccess: () => router.refresh(),
  });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={on ? "accent" : "neutral"}>{on ? labels.on : labels.off}</Badge>
      {disabled && !on ? null : (
        <Button variant="secondary" size="sm" loading={change.isPending} onClick={() => change.mutate()}>
          {on ? labels.unset : labels.set}
        </Button>
      )}
      {change.isError ? (
        <span role="alert" className="text-xs text-danger">
          {say(`errors.${errorKey(change.error)}`)}
        </span>
      ) : null}
    </span>
  );
}
function runColumns(say: Say, locale: Lang): DataTableColumn<AdminRun>[] {
  return [
    {
      id: "started",
      header: say("adminConsole.runs.started"),
      sortable: true,
      value: (r) => r.createdAt,
      cell: (r) => formatDate(r.createdAt, locale, true),
    },
    {
      id: "studio",
      header: say("adminConsole.runs.studio"),
      sortable: true,
      card: "title",
      value: (r) => r.studio,
      filter: "facet",
    },
    {
      id: "status",
      header: say("adminConsole.runs.status"),
      value: (r) => r.status,
      cell: (r) => <Badge tone={RUN_TONE[r.status] ?? "neutral"}>{say(`analysis.statuses.${r.status}`)}</Badge>,
    },
    {
      id: "runId",
      header: say("adminConsole.runs.runId"),
      value: (r) => r.runId ?? "",
      cell: (r) => <code className="font-mono text-xs">{r.runId ?? "—"}</code>,
    },
    {
      id: "duration",
      header: say("adminConsole.runs.duration"),
      sortable: true,
      align: "end",
      value: (r) => r.durationSeconds ?? -1,
      cell: (r) => (r.durationSeconds === null ? "—" : `${r.durationSeconds} s`),
    },
    { id: "document", header: say("adminConsole.runs.document"), value: (r) => r.document },
    { id: "owner", header: say("adminConsole.runs.owner"), value: (r) => r.owner },
    {
      id: "showcase",
      header: say("adminConsole.runs.showcase"),
      value: (r) => (r.showcase ? "yes" : "no"),
      cell: (r) => (
        <FlagButton
          url={`/api/admin/analyses/${r.id}/showcase`}
          on={r.showcase}
          disabled={!r.showable}
          labels={{
            on: say("adminConsole.runs.public"),
            off: say("adminConsole.runs.private"),
            set: say("adminConsole.runs.promote"),
            unset: say("adminConsole.runs.withdraw"),
          }}
        />
      ),
    },
    {
      id: "error",
      header: say("adminConsole.runs.error"),
      value: (r) => r.error ?? "",
      cell: (r) => (r.error ? <span className="text-danger">{r.error}</span> : "—"),
    },
  ];
}

export function RunsTable({ rows }: Readonly<{ rows: AdminRun[] }>) {
  const { say, locale } = useSay();
  const columns = useMemo(() => runColumns(say, locale), [say, locale]);
  return (
    <DataTable
      caption={say("adminConsole.runs.caption")}
      showCaption
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowLabel={(r) => r.runId ?? r.id}
      defaultSort={{ column: "started", direction: "descending" }}
      pageSize={50}
    />
  );
}
function documentColumns(say: Say, locale: Lang): DataTableColumn<AdminDocument>[] {
  return [
    { id: "title", header: say("adminConsole.documents.title"), sortable: true, card: "title", value: (d) => d.title },
    {
      id: "owner",
      header: say("adminConsole.documents.owner"),
      sortable: true,
      value: (d) => d.owner,
      filter: "facet",
    },
    {
      id: "kind",
      header: say("adminConsole.documents.kind"),
      value: (d) => d.kind,
      cell: (d) => say(`kinds.${d.kind}`),
    },
    {
      id: "type",
      header: say("adminConsole.documents.type"),
      value: (d) => (d.mimeType === "application/pdf" ? "PDF" : "TXT"),
    },
    {
      id: "size",
      header: say("adminConsole.documents.size"),
      sortable: true,
      align: "end",
      value: (d) => d.sizeBytes,
      cell: (d) => formatBytes(d.sizeBytes, locale),
    },
    {
      id: "analyses",
      header: say("adminConsole.documents.analyses"),
      sortable: true,
      align: "end",
      value: (d) => d.analyses,
    },
    {
      id: "sample",
      header: say("adminConsole.documents.sample"),
      value: (d) => (d.sample ? "yes" : "no"),
      cell: (d) => (
        <FlagButton
          url={`/api/admin/documents/${d.id}/sample`}
          on={d.sample}
          labels={{
            on: say("adminConsole.documents.isSample"),
            off: say("adminConsole.documents.isPersonal"),
            set: say("adminConsole.documents.markSample"),
            unset: say("adminConsole.documents.unmarkSample"),
          }}
        />
      ),
    },
    {
      id: "added",
      header: say("adminConsole.documents.added"),
      sortable: true,
      align: "end",
      value: (d) => d.createdAt,
      cell: (d) => formatDate(d.createdAt, locale),
    },
  ];
}

export function DocumentsTable({ rows }: Readonly<{ rows: AdminDocument[] }>) {
  const { say, locale } = useSay();
  const columns = useMemo(() => documentColumns(say, locale), [say, locale]);
  return (
    <DataTable
      caption={say("adminConsole.documents.caption")}
      showCaption
      rows={rows}
      columns={columns}
      getRowId={(d) => d.id}
      rowLabel={(d) => d.title}
      defaultSort={{ column: "added", direction: "descending" }}
      pageSize={50}
    />
  );
}
function auditColumns(say: Say, locale: Lang): DataTableColumn<AdminAuditEntry>[] {
  return [
    {
      id: "at",
      header: say("adminConsole.audit.at"),
      sortable: true,
      value: (e) => e.at,
      cell: (e) => formatDate(e.at, locale, true),
    },
    {
      id: "actor",
      header: say("adminConsole.audit.actor"),
      sortable: true,
      card: "title",
      value: (e) => e.actor,
      filter: "facet",
    },
    {
      id: "action",
      header: say("adminConsole.audit.action"),
      value: (e) => e.action,
      cell: (e) => <code className="font-mono text-xs">{e.action}</code>,
      filter: "facet",
    },
    {
      id: "target",
      header: say("adminConsole.audit.target"),
      value: (e) => e.target ?? "",
      cell: (e) => <code className="break-all font-mono text-xs">{e.target ?? "—"}</code>,
    },
    { id: "ip", header: say("adminConsole.audit.ip"), value: (e) => e.ip ?? "" },
  ];
}

export function AuditTable({ entries }: Readonly<{ entries: AdminAuditEntry[] }>) {
  const { say, locale } = useSay();
  const columns = useMemo(() => auditColumns(say, locale), [say, locale]);
  return (
    <DataTable
      caption={say("adminConsole.audit.caption")}
      showCaption
      rows={entries}
      columns={columns}
      getRowId={(e) => e.id}
      rowLabel={(e) => e.action}
      defaultSort={{ column: "at", direction: "descending" }}
      pageSize={50}
    />
  );
}
