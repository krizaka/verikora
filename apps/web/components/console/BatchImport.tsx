"use client";

import { krizakaFetch } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { Dropzone } from "@krizaka/ui/file-upload";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";

type Say = ReturnType<typeof useSay>["say"];

/** What the preview answers (lib/batch/preview.ts). */
interface PreviewRow {
  line: number;
  file: string;
  studio: string | null;
  state: "check" | "reuse" | "refused";
  errors: string[];
  reference: string | null;
}
interface Preview {
  rows: PreviewRow[];
  missingColumns: string[];
  unknownColumns: string[];
  unnamedFiles: string[];
  counts: { check: number; reuse: number; refused: number };
  cost: { audits: number; covered: boolean; credits: number; pro: boolean };
}

const STATE_TONE = { check: "accent", reuse: "success", refused: "danger" } as const;
const isCsv = (f: File) => /\.csv$/i.test(f.name) || f.type === "text/csv";

/** The documents kept after a drop: the earlier ones the drop does not replace by name, then the dropped documents (the CSV is the manifest). */
export function mergeDocuments(kept: readonly File[], dropped: readonly File[]): File[] {
  return [...kept.filter((f) => !dropped.some((d) => d.name === f.name)), ...dropped.filter((f) => !isCsv(f))];
}

/** The key of the sentence that says what the batch costs. */
export function costKey(cost: Preview["cost"]): "batch.cost.pro" | "batch.cost.covered" | "batch.cost.short" {
  if (cost.pro) return "batch.cost.pro";
  return cost.covered ? "batch.cost.covered" : "batch.cost.short";
}
function previewColumns(say: Say): DataTableColumn<PreviewRow>[] {
  return [
    { id: "line", header: say("batch.columns.line"), type: "number", value: (r) => r.line },
    {
      id: "file",
      header: say("batch.columns.file"),
      type: "title",
      card: "title",
      filter: "text",
      value: (r) => r.file,
      cell: (r) => <span className="break-all text-sm">{r.file || "—"}</span>,
    },
    {
      id: "check",
      header: say("batch.columns.check"),
      value: (r) => r.studio ?? "",
      cell: (r) => (r.studio ? say(`batch.studios.${r.studio}`) : "—"),
    },
    {
      id: "state",
      header: say("batch.columns.state"),
      type: "status",
      filter: "facet",
      options: (["check", "reuse", "refused"] as const).map((s) => ({ value: s, label: say(`batch.preview.${s}`) })),
      value: (r) => r.state,
      cell: (r) => <Badge tone={STATE_TONE[r.state]}>{say(`batch.preview.${r.state}`)}</Badge>,
    },
    {
      id: "reason",
      header: say("batch.columns.reason"),
      value: (r) => r.errors.join(" "),
      cell: (r) => (r.errors.length ? r.errors.map((e) => say(`errors.${e}`)).join(" · ") : "—"),
    },
    { id: "reference", header: say("batch.columns.reference"), priority: 3, value: (r) => r.reference ?? "" },
  ];
}

/**
 * A batch of checks (verikora#232): drop the CSV and the documents it names together; the preview says row by row what will
 * be checked, reused (no audit) or refused and why, and the audits it costs; then one action starts it and its page follows it.
 */
export function BatchImport() {
  const { say, locale } = useSay();
  const router = useRouter();
  const [manifest, setManifest] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "start" | null>(null);

  const form = (m: File, fs: readonly File[]) => {
    const body = new FormData();
    body.set("manifest", m);
    for (const f of fs) body.append("files", f);
    return body;
  };
  const refusal = (error: unknown) =>
    say(`errors.${errorKey(error)}`, (error as { body?: Record<string, string | number> })?.body);

  const onFiles = async (dropped: File[]) => {
    const csv = dropped.find(isCsv) ?? manifest;
    const docs = mergeDocuments(files, dropped);
    setManifest(csv);
    setFiles(docs);
    setProblem(null);
    if (!csv) return setPreview(null);
    setBusy("preview");
    try {
      setPreview((await krizakaFetch("/api/batches/preview", { method: "POST", body: form(csv, docs) })) as Preview);
    } catch (error) {
      setPreview(null);
      setProblem(refusal(error));
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!manifest) return;
    setBusy("start");
    try {
      const { batch } = (await krizakaFetch("/api/batches", { method: "POST", body: form(manifest, files) })) as {
        batch: { id: string };
      };
      router.push(`/${locale}/app/check/batches/${batch.id}`);
    } catch (error) {
      setProblem(refusal(error));
      setBusy(null);
    }
  };

  const columns = useMemo(() => previewColumns(say), [say]);

  return (
    <div className="flex flex-col gap-5">
      <Card.Root className="p-4">
        <h2 className="mb-1 font-display text-lg font-bold text-fg">{say("batch.title")}</h2>
        <p className="mb-3 text-sm text-fg-secondary">{say("batch.lead")}</p>
        <Dropzone
          title={say("batch.drop")}
          browseLabel={say("library.browse")}
          inputLabel={say("batch.inputLabel")}
          hint={say("batch.hint")}
          multiple
          maxFiles={500}
          onFiles={onFiles}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <a
            className="font-semibold text-fg-accent underline-offset-2 hover:underline"
            href="/api/batches/template"
            download
          >
            {say("batch.template")}
          </a>
          {manifest ? (
            <span className="text-fg-secondary">
              {say("batch.received", { csv: manifest.name, count: files.length })}
            </span>
          ) : null}
        </div>
      </Card.Root>

      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {busy === "preview" ? <p className="text-sm text-fg-secondary">{say("batch.previewing")}</p> : null}

      {preview ? (
        <PreviewPanel preview={preview} columns={columns} starting={busy === "start"} onStart={start} />
      ) : null}
    </div>
  );
}

function PreviewPanel({
  preview,
  columns,
  starting,
  onStart,
}: Readonly<{ preview: Preview; columns: DataTableColumn<PreviewRow>[]; starting: boolean; onStart: () => void }>) {
  const { say } = useSay();
  return (
    <Card.Root className="flex flex-col gap-4 p-4">
      {preview.missingColumns.length ? (
        <Alert tone="danger">{say("batch.missingColumns", { columns: preview.missingColumns.join(", ") })}</Alert>
      ) : null}
      {preview.unknownColumns.length ? (
        <Alert tone="info">{say("batch.unknownColumns", { columns: preview.unknownColumns.join(", ") })}</Alert>
      ) : null}
      {preview.unnamedFiles.length ? (
        <Alert tone="info">{say("batch.unnamedFiles", { files: preview.unnamedFiles.join(", ") })}</Alert>
      ) : null}
      <p className="text-sm text-fg">
        {say("batch.summary", {
          check: preview.counts.check,
          reuse: preview.counts.reuse,
          refused: preview.counts.refused,
        })}
      </p>
      <Alert tone={preview.cost.covered ? "success" : "warning"}>
        {say(
          costKey(preview.cost),
          preview.cost.pro
            ? { audits: preview.cost.audits }
            : { audits: preview.cost.audits, credits: preview.cost.credits },
        )}
      </Alert>
      <DataTable
        caption={say("batch.previewCaption")}
        rows={preview.rows}
        columns={columns}
        getRowId={(r) => String(r.line)}
        rowLabel={(r) => r.file}
        pageSize={12}
      />
      <div>
        <Button
          variant="primary"
          size="md"
          shape="cut"
          loading={starting}
          disabled={!preview.counts.check && !preview.counts.reuse}
          onClick={onStart}
        >
          {say("batch.start", { count: preview.counts.check + preview.counts.reuse })}
        </Button>
      </div>
    </Card.Root>
  );
}
