"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { DescriptionList } from "@krizaka/ui/description-list";
import { DocumentViewer, type Located } from "@krizaka/ui/document-viewer";
import { createKrizakaForm } from "@krizaka/ui/form";
import { PageHeader } from "@krizaka/ui/page-header";
import { Spinner } from "@krizaka/ui/spinner";
import { StepProgress } from "@krizaka/ui/step-progress";
import { Tabs } from "@krizaka/ui/tabs";
import { type Analysis, analysis as analysisSchema, type Audience, AUTHENTICITY_MAX_BYTES, type AuthenticityReport, checkSteps,type ComplianceReport, type DocumentView as DocumentViewData, documentView, DOCX_MIME, isSeededCheck, type Jurisdiction, JURISDICTIONS, ODT_MIME, passages, queryKeys, STEP_STATE, type Studio, type TextSource } from "@yomizaka/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { ClosingNoteView } from "@/components/ClosingNoteView";
import { CheckSteps } from "@/components/console/CheckSteps";
import { DocumentInsight } from "@/components/console/DocumentInsight";
import { Paywall } from "@/components/console/Paywall";
import { errorKey } from "@/lib/client";
import { buildNote, noteInputOf, noteSourceOf } from "@/lib/closing-note/build";
import { type DocumentTab } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { firstCheck, wordingOf } from "@/lib/perspective-defaults";
import { photoOriginSignals } from "@/lib/photo-origin";

import { STATUS_TONE } from "./DocumentTable";
import { formatBytes, formatDate } from "./format";
import { ReportShare } from "./ReportShare";
import { StorageNotice } from "./StorageNotice";

const VERDICT_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { PASS: "success", FAIL: "danger", INSUFFICIENT_EVIDENCE: "warning" };
const LEVEL_TONE: Record<string, "neutral" | "warning" | "danger"> = { observé: "neutral", inhabituel: "warning", incohérent: "danger" };
const RUN_TONE = { running: "accent", succeeded: "success", failed: "danger", cancelled: "neutral" } as const;

const compliance = createKrizakaForm({
  schema: z.object({ documentType: z.enum(["lease", "invoice", "contract"]), jurisdiction: z.enum(JURISDICTIONS), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  defaultValues: { documentType: "lease" as "lease" | "invoice" | "contract", jurisdiction: "QC" as (typeof JURISDICTIONS)[number], asOf: new Date().toISOString().slice(0, 10) },
});
const authenticity = createKrizakaForm({
  schema: z.object({ expectedIssuer: z.string().trim().max(120) }),
  defaultValues: { expectedIssuer: "" },
});

/** pdf.js is loaded on this page only, and its worker is served from this origin (CSP: 'self'). */
const loadPdfjs = () => import("pdfjs-dist") as unknown as ReturnType<ComponentProps<typeof DocumentViewer>["loadPdfjs"]>;
const WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Where Orazaka's finding sits in the file, in words — never a place the PDF's text layer did not confirm. */
function placeOf(found: Located | null | undefined, say: (key: string, vars?: Record<string, string | number>) => string): string | null {
  if (found === undefined) return null;
  if (found === null) return say("analysis.findingNotFound");
  return found.match === "page" ? say("analysis.findingPageOnly", { page: found.page }) : say("analysis.findingPage", { page: found.page });
}

/** The document's text, the passages a compliance report quotes marked where they sit. */
function DocumentText({ text, report }: { text: string; report: ComplianceReport | null }) {
  const { say } = useSay();
  const parts = useMemo(
    () => passages(text, (report?.findings ?? []).filter((f) => f.evidenceSpan?.quote).map((f) => ({ id: f.ruleId, quote: f.evidenceSpan!.quote, start: f.evidenceSpan!.start ?? undefined }))),
    [text, report],
  );
  return (
    <div className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border-default bg-surface-1 p-4 font-mono text-xs leading-relaxed text-fg-secondary">
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} id={`passage-${p.mark}`} className="ym-passage text-fg" title={say("document.passageOf", { rule: p.mark })}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}

function ComplianceFindings({ report, runId, selection }: { report: ComplianceReport; runId: string | null; selection?: Selection }) {
  const { say } = useSay();
  const failures = report.summary?.blockingFailures ?? report.findings.filter((f) => f.verdict === "FAIL" && f.severity === "BLOCKING").length;
  return (
    <div className="flex flex-col gap-3">
      {report.reviewStatus ? <Alert tone="warning">{say("analysis.toReview")}</Alert> : null}
      <p className="text-sm text-fg-secondary">{say("analysis.summary", { failures, rules: report.summary?.rulesEvaluated ?? report.findings.length })}</p>
      <ul className="flex flex-col gap-2">
        {report.findings.map((f) => {
          const active = selection?.activeId === f.ruleId;
          const place = f.evidenceSpan?.quote ? placeOf(selection?.found[f.ruleId], say) : null;
          return (
            <li key={f.ruleId} id={`finding-${f.ruleId}`} data-active={active} className="rounded-lg border border-border-default bg-surface-1 p-3 text-sm data-[active=true]:border-accent data-[active=true]:bg-surface-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-fg">{f.title ?? f.ruleId}</span>
                <Badge tone={VERDICT_TONE[f.verdict] ?? "neutral"}>{say(`analysis.verdicts.${f.verdict}`)}</Badge>
              </div>
              <p className="mt-1 text-fg-secondary">{f.explanation}</p>
              <dl className="mt-2 grid gap-1 text-xs text-fg-muted sm:grid-cols-[auto_1fr] sm:gap-x-3">
                <dt>{say("analysis.severity")}</dt>
                <dd className="font-mono">
                  {f.ruleId} · {f.severity}
                  {f.method ? ` · ${f.method}` : ""}
                </dd>
                {f.citation ? (
                  <>
                    <dt>{say("analysis.citation")}</dt>
                    <dd data-testid="finding-citation">{f.citation}</dd>
                  </>
                ) : null}
                <dt>{say("analysis.passage")}</dt>
                <dd>
                  {f.evidenceSpan?.quote ? (
                    <>
                      <a href={`#passage-${f.ruleId}`} className="italic text-fg-accent hover:underline">
                        « {f.evidenceSpan.quote} »
                      </a>
                      {place ? <span className="ml-2 whitespace-nowrap" data-testid="finding-place">· {place}</span> : null}
                    </>
                  ) : (
                    say("analysis.noPassage")
                  )}
                </dd>
                {runId ? (
                  <>
                    <dt>{say("analysis.orazakaRun")}</dt>
                    <dd className="break-all font-mono">{runId}</dd>
                  </>
                ) : null}
              </dl>
              {selection && f.evidenceSpan?.quote ? (
                <Button className="mt-2" size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={() => selection.onSelect(active ? null : f.ruleId)}>
                  {say("analysis.showInFile")}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the document page shares with the findings of its latest compliance check: which finding is lit, and where each sits. */
interface Selection {
  activeId: string | null;
  found: Record<string, Located | null>;
  onSelect: (id: string | null) => void;
}

/** The signed audit report of a finished check: what it holds, its fingerprint, the download, and where anyone verifies it. */
function ReportExport({ documentId, analysisId }: { documentId: string; analysisId: string }) {
  const { say, locale } = useSay();
  const base = `/api/documents/${documentId}/analyses/${analysisId}/report?lang=${locale}`;
  // A report the server refuses (409 REPORT_NOT_READY) is said in place; it never takes the page down.
  const meta = useQuery({
    queryKey: [...queryKeys.document(documentId), "report", analysisId, locale],
    queryFn: () => krizakaFetch(`${base}&meta=1`, { schema: z.object({ report: z.object({ fileSha256: z.string(), keyId: z.string(), filename: z.string() }) }) }).then((r) => r.report),
    staleTime: Infinity,
    retry: false,
    throwOnError: false,
  });
  if (meta.isError) {
    return (
      <div className="flex flex-col gap-2 border-t border-border-default pt-3">
        <h4 className="text-sm font-semibold text-fg">{say("analysis.exportReport")}</h4>
        <Alert tone="info" data-testid="report-unavailable">{say("analysis.exportUnavailable")}</Alert>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border-default pt-3">
      <h4 className="text-sm font-semibold text-fg">{say("analysis.exportReport")}</h4>
      <p className="text-xs text-fg-secondary">{say("analysis.exportHint")}</p>
      {meta.data ? (
        <DescriptionList
          items={[
            { term: say("analysis.exportSha"), details: <code className="break-all font-mono text-xs" data-testid="report-sha256">{meta.data.fileSha256}</code> },
            { term: say("analysis.exportKey"), details: <code className="font-mono text-xs">{meta.data.keyId}</code> },
          ]}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <a href={base} download={meta.data?.filename} data-testid="report-download">
            {say("analysis.exportDownload")}
          </a>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <a href={`${base}&format=pdf`} download data-testid="report-download-pdf">
            {say("analysis.exportPdf")}
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/${locale}/verify`} target="_blank">
            {say("analysis.exportVerify")}
          </Link>
        </Button>
      </div>
      <ReportShare documentId={documentId} analysisId={analysisId} />
    </div>
  );
}

function AuthenticitySignals({ report }: { report: Pick<AuthenticityReport, "header" | "signals"> }) {
  const { say } = useSay();
  return (
    <div className="flex flex-col gap-3">
      {report.header ? <Alert tone="info">{report.header}</Alert> : null}
      <ul className="flex flex-col gap-2">
        {report.signals.map((s) => (
          <li key={s.signalId} className="rounded-lg border border-border-default bg-surface-1 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-fg-muted">{s.signalId}</span>
              <Badge tone={LEVEL_TONE[s.level] ?? "neutral"}>{say(`analysis.levels.${s.level}`)}</Badge>
            </div>
            <p className="mt-1 text-fg">{s.observation}</p>
            {s.mayIndicate ? (
              <p className="mt-1 text-fg-secondary">
                <strong className="font-semibold">{say("analysis.mayIndicate")} · </strong>
                {s.mayIndicate}
              </p>
            ) : null}
            {s.where ? <p className="mt-1 text-xs text-fg-muted">{s.where}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A photo document's origin, read at upload (its metadata never leaves the intake, ADR-0010), as the report's signals. */
function PhotoOriginSignals({ source }: { source: TextSource }) {
  const { say, locale } = useSay();
  const signals = photoOriginSignals(source.origin).map((s) => {
    const facts = { ...s.facts, ...(s.facts.taken ? { taken: formatDate(s.facts.taken, locale, true), modified: formatDate(s.facts.modified, locale, true) } : {}) };
    return { signalId: s.signalId, level: s.level, observation: say(`analysis.photoOrigin.${s.case}.observation`, facts), mayIndicate: say(`analysis.photoOrigin.${s.case}.mayIndicate`), where: say("analysis.photoOrigin.where") };
  });
  return <AuthenticitySignals report={{ header: say("analysis.photoOrigin.header"), signals }} />;
}

/** One analysis: its Orazaka run (id, version, status), polled while it runs, then its report. */
function AnalysisCard({ documentId, initial, selection, source, hasText }: { documentId: string; initial: Analysis; selection?: Selection; source?: TextSource; hasText: boolean }) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const live = useQuery({
    queryKey: [...queryKeys.document(documentId), "analysis", initial.id],
    queryFn: () => krizakaFetch(`/api/documents/${documentId}/analyses/${initial.id}`, { schema: z.object({ analysis: analysisSchema }) }).then((r) => r.analysis),
    initialData: initial,
    enabled: initial.status === "running",
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
  });
  const a = live.data ?? initial;
  useEffect(() => {
    if (initial.status === "running" && a.status !== "running") void client.invalidateQueries({ queryKey: queryKeys.documents() });
  }, [a.status, initial.status, client]);
  const ruleset = a.report && "rulesetId" in a.report ? `${a.report.rulesetId} · ${a.report.rulesetVersion}` : null;
  return (
    <Card.Root className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-fg">{say(a.studio === "compliance-check" ? "analysis.complianceTitle" : "analysis.authenticityTitle")}</h3>
        <Badge tone={RUN_TONE[a.status]}>{a.status === "running" ? <Spinner size="sm" label={say("analysis.running")} /> : null} {say(`analysis.statuses.${a.status}`)}</Badge>
      </div>
      <CheckSteps steps={checkSteps({ hasText, analysis: { studio: a.studio, status: a.status } })} />
      <DescriptionList
        items={[
          { term: say("analysis.runId"), details: <code className="break-all font-mono text-xs" data-testid="orazaka-run-id">{a.runId ?? "—"}</code> },
          ...(a.blueprintVersion ? [{ term: say("analysis.blueprint"), details: `${a.studio} · ${a.blueprintVersion}` }] : []),
          ...(ruleset ? [{ term: say("analysis.ruleset"), details: ruleset }] : []),
          ...(a.inputs.jurisdiction ? [{ term: say("analysis.jurisdiction"), details: `${a.inputs.jurisdiction} · ${a.inputs.asOf ?? ""}` }] : []),
          ...(a.inputs.expectedIssuer ? [{ term: say("analysis.expectedIssuer"), details: a.inputs.expectedIssuer }] : []),
          { term: say("analysis.started"), details: formatDate(a.createdAt, locale, true) },
          ...(a.finishedAt ? [{ term: say("analysis.finished"), details: formatDate(a.finishedAt, locale, true) }] : []),
        ]}
      />
      {a.status === "running" ? <p className="text-sm text-fg-secondary">{say("analysis.running")}</p> : null}
      {a.error ? <Alert tone="danger">{a.error}</Alert> : null}
      {a.report && "findings" in a.report ? <ComplianceFindings report={a.report} runId={a.runId} selection={selection} /> : null}
      {a.status === "succeeded" && a.studio === "compliance-check" && a.report && "findings" in a.report ? (
        isSeededCheck(a) ? (
          // The demo data set (krizaka/yomizaka#274): its checks were written, not run — shown, never certified.
          <Alert tone="info" data-testid="seeded-note">{say("analysis.seededNote")}</Alert>
        ) : (
          <ReportExport documentId={documentId} analysisId={a.id} />
        )
      ) : null}
      {a.report && "signals" in a.report ? <AuthenticitySignals report={a.report} /> : null}
      {a.status === "succeeded" && a.report ? <ClosingNoteView note={buildNote(noteInputOf(a.report, noteSourceOf(source)), locale)} /> : null}
      {a.report ? <p className="text-xs text-fg-muted">{say("analysis.language")}</p> : null}
    </Card.Root>
  );
}

function StartCompliance({ documentId, disabled, jurisdictions, types, initialType }: { documentId: string; disabled: boolean; initialType?: "lease" | "invoice" | "contract"; jurisdictions: readonly (typeof JURISDICTIONS)[number][]; types: readonly ("invoice" | "contract")[] }) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [reused, setReused] = useState(false);
  // A check the task page tried to start on the drop and the engine refused arrives as `?refused=<code>`: said here, above the form.
  const refused = useSearchParams()?.get("refused") ?? null;
  const [problem, setProblem] = useState<string | null>(refused && refused !== "PAYWALL" && refused !== "FAIR_USE" ? say(`errors.${refused}`) : null);
  const [paywall, setPaywall] = useState<"PAYWALL" | "FAIR_USE" | null>(refused === "PAYWALL" || refused === "FAIR_USE" ? refused : null);
  const start = useMutation({
    // The Québec invoice is a named ruleset of the Studio (and Québec's alone); a lease keeps the jurisdiction's own.
    mutationFn: (body: { documentType: "lease" | "invoice" | "contract"; jurisdiction: string; asOf: string }) =>
      krizakaFetch(`/api/documents/${documentId}`, {
        method: "POST",
        json: { studio: "compliance-check", asOf: body.asOf, ...(body.documentType === "invoice" ? { jurisdiction: "QC", ruleset: "qc-invoice" } : body.documentType === "contract" ? { jurisdiction: "QC", ruleset: "qc-service-contract" } : { jurisdiction: body.jurisdiction }) },
      }),
    onSuccess: (data) => {
      setReused(Boolean((data as { reused?: boolean } | null)?.reused));
      return client.invalidateQueries({ queryKey: queryKeys.document(documentId) });
    },
  });
  const form = compliance.useForm({
    defaultValues: { documentType: initialType ?? "lease", jurisdiction: "QC", asOf: new Date().toISOString().slice(0, 10) },
    i18n: { t: (key, vars) => say(key, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await start.mutateAsync(values);
      } catch (error) {
        const code = errorKey(error);
        if (code === "PAYWALL" || code === "FAIR_USE") setPaywall(code);
        else setProblem(say(`errors.${code}`));
      }
    },
  });
  return (
    <form.Form aria-label={say("analysis.complianceTitle")} className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">{say("analysis.complianceText")}</p>
      {types.length ? (
        <form.Select name="documentType" label={say("analysis.documentType")} options={(["lease", ...types] as const).map((k) => ({ value: k, label: say(`analysis.documentTypes.${k}`) }))} />
      ) : null}
      {/* The rules derive from the kind chosen now (the review's C5): Québec's named rulesets for an invoice or a contract, said in one line; a lease keeps its jurisdiction menu. */}
      <form.Field name="documentType">
        {(field) =>
          field.value !== "lease" ? (
            <p className="m-0 text-sm text-fg-secondary" data-testid="rules-line">
              {say("analysis.rulesLine", { kind: say(`analysis.kindWords.${String(field.value)}`) })}
            </p>
          ) : (
            <form.Select name="jurisdiction" label={say("analysis.jurisdiction")} options={jurisdictions.map((j) => ({ value: j, label: say(`analysis.jurisdictions.${j}`) }))} />
          )
        }
      </form.Field>
      <form.DateField name="asOf" label={say("analysis.asOf")} />
      {paywall ? <Paywall reason={paywall} /> : null}
      {reused ? <Alert tone="info">{say("analysis.reused")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Submit disabled={disabled}>
        {say("analysis.run")}
      </form.Submit>
    </form.Form>
  );
}

function StartAuthenticity({ documentId, disabled }: { documentId: string; disabled: boolean }) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [reused, setReused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<"PAYWALL" | "FAIR_USE" | null>(null);
  const start = useMutation({
    mutationFn: (body: { expectedIssuer: string }) =>
      krizakaFetch(`/api/documents/${documentId}`, { method: "POST", json: { studio: "document-authenticity", ...(body.expectedIssuer ? { expectedIssuer: body.expectedIssuer } : {}) } }),
    onSuccess: (data) => {
      setReused(Boolean((data as { reused?: boolean } | null)?.reused));
      return client.invalidateQueries({ queryKey: queryKeys.document(documentId) });
    },
  });
  const form = authenticity.useForm({
    i18n: { t: (key, vars) => say(key, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await start.mutateAsync(values);
      } catch (error) {
        const code = errorKey(error);
        if (code === "PAYWALL" || code === "FAIR_USE") setPaywall(code);
        else setProblem(say(`errors.${code}`));
      }
    },
  });
  return (
    <form.Form aria-label={say("analysis.authenticityTitle")} className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">{say("analysis.authenticityText")}</p>
      <form.TextField name="expectedIssuer" label={say("analysis.expectedIssuer")} hint={say("analysis.expectedIssuerHint")} />
      {paywall ? <Paywall reason={paywall} /> : null}
      {reused ? <Alert tone="info">{say("analysis.reused")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Submit variant="secondary" disabled={disabled}>
        {say("analysis.run")}
      </form.Submit>
    </form.Form>
  );
}

/** The document page: the file and its text on one side, Orazaka's checks on the other — each a traced run. */
export function DocumentView({ initial, tab, perspective = null, offer }: { initial: DocumentViewData; tab: DocumentTab; perspective?: Audience | null; offer: { studios: readonly Studio[]; jurisdictions: readonly Jurisdiction[]; rulesets: readonly string[] } }) {
  const { say, locale } = useSay();
  const router = useRouter();
  const client = useQueryClient();
  const doc = useQuery({
    queryKey: queryKeys.document(initial.id),
    queryFn: () => krizakaFetch(`/api/documents/${initial.id}`, { schema: z.object({ document: documentView }) }).then((r) => r.document),
    initialData: initial,
  }).data;
  const remove = useMutation({
    mutationFn: () => krizakaFetch(`/api/documents/${initial.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.documents() });
      router.replace(`/${locale}/app`);
    },
  });
  const [confirming, setConfirming] = useState(false);
  // The tab is the route (/documents/[id]/infos|verifications|fichier|texte): back, forward, refresh and sharing all work.
  const go = (next: DocumentTab) => router.push(`/${locale}/app/documents/${initial.id}/${next}`, { scroll: false });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, Located | null>>({});
  const viewerRef = useRef<HTMLElement>(null);
  const fileUrl = `/api/documents/${doc.id}/file`;
  const latestCompliance = doc.analyses.find((a) => a.studio === "compliance-check" && a.report && "findings" in a.report);
  const running = (studio: Analysis["studio"]) => doc.analyses.some((a) => a.studio === studio && a.status === "running");
  const isPdf = doc.mimeType === "application/pdf";
  const examinable = isPdf || doc.mimeType === DOCX_MIME || doc.mimeType === ODT_MIME;
  const complianceCard = (
    <Card.Root key="compliance-check" className="p-4">
      <h3 className="mb-2 font-display text-base font-bold text-fg">{say("analysis.complianceTitle")}</h3>
      {doc.insight && doc.insight.understanding.nature && !doc.insight.understanding.check ? <Alert tone="info">{say("insight.noCheck")}</Alert> : doc.hasText ? <StartCompliance documentId={doc.id} initialType={doc.insight?.understanding.check?.documentType} disabled={running("compliance-check")} jurisdictions={offer.jurisdictions} types={[...(offer.rulesets.includes("qc-invoice") ? (["invoice"] as const) : []), ...(offer.rulesets.includes("qc-service-contract") ? (["contract"] as const) : [])]} /> : <Alert tone="info">{say("document.noText")}</Alert>}
    </Card.Root>
  );
  const authenticityCard = (
    <Card.Root key="document-authenticity" className="p-4">
      <h3 className="mb-2 font-display text-base font-bold text-fg">{say("analysis.authenticityTitle")}</h3>
      {doc.textSource ? <PhotoOriginSignals source={doc.textSource} /> : !examinable ? <Alert tone="info">{say("analysis.noPdf")}</Alert> : doc.sizeBytes > AUTHENTICITY_MAX_BYTES ? <Alert tone="info">{say("analysis.tooLarge")}</Alert> : <StartAuthenticity documentId={doc.id} disabled={running("document-authenticity")} />}
    </Card.Root>
  );
  const latestReport = latestCompliance?.report && "findings" in latestCompliance.report ? latestCompliance.report : null;
  const highlights = useMemo(
    () => (latestReport?.findings ?? []).filter((f) => f.evidenceSpan?.quote).map((f) => ({ id: f.ruleId, quote: f.evidenceSpan!.quote, label: f.title ?? f.ruleId })),
    [latestReport],
  );
  // While a check runs, where it stands (Lecture › Contrôle › Règles › Rapport), at the top of the tab (the review's C4).
  const runningStudio = (["compliance-check", "document-authenticity"] as const).find((s) => running(s)) ?? null;
  const runningSteps = runningStudio ? checkSteps({ hasText: doc.hasText, analysis: { studio: runningStudio, status: "running" } }) : [];
  const runningStep = Math.max(1, runningSteps.findIndex((s) => s.state === STEP_STATE.current) + 1);
  const selection: Selection = {
    activeId,
    found,
    onSelect: (id) => {
      setActiveId(id);
      if (id) {
        go(isPdf ? "fichier" : "texte");
        // On a narrow screen the file sits above the findings: bring it into view; the viewer scrolls to the passage itself.
        if (window.matchMedia?.("(max-width: 1279px)").matches) viewerRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        if (!isPdf) document.getElementById(`passage-${id}`)?.scrollIntoView({ block: "center" });
      }
    },
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href={`/${locale}/app`} className="text-sm text-fg-muted hover:text-fg">
            ← {say("document.back")}
          </Link>
        }
        title={<span className="break-words">{doc.title}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[doc.status]}>{say(`statuses.${doc.status}`)}</Badge>
            <Badge tone="neutral">{say(`kinds.${doc.kind}`)}</Badge>
          </span>
        }
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <a href={fileUrl} target="_blank" rel="noreferrer">
                {say("document.openFile")}
              </a>
            </Button>
            {confirming ? (
              <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
                {say("document.deleteConfirm")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                {say("document.delete")}
              </Button>
            )}
          </>
        }
      />

      {/* @ephemeral: already the route (/documents/[id]/<tab>), pushed by go(); to move to Tabs.Nav */}
      <Tabs.Root value={tab} onValueChange={(v: string) => go(v as DocumentTab)}>
        {/* Four tabs do not fit a 360 px phone: the row scrolls sideways rather than widening the page (D6; Y5 brings them to three). */}
        <Tabs.List aria-label={say("document.viewer")} className="max-w-full overflow-x-auto">
          <Tabs.Trigger value="infos">{say("document.tabs.infos")}</Tabs.Trigger>
          <Tabs.Trigger value="verifications">{say("document.tabs.verifications")}</Tabs.Trigger>
          {isPdf && !doc.purged ? <Tabs.Trigger value="fichier">{say("document.file")}</Tabs.Trigger> : null}
          <Tabs.Trigger value="texte">{say("document.text")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="infos">
          <section aria-label={say("document.tabs.infos")} className="flex min-w-0 flex-col gap-4 pt-4">
            {doc.insight ? <DocumentInsight insight={doc.insight} documentId={doc.id} source={doc.textSource} /> : null}
            <StorageNotice storage={doc.storage} retainUntil={doc.retainUntil} purged={doc.purged} onDelete={() => remove.mutate()} deleting={remove.isPending} />
            <DescriptionList
              items={[
                { term: say("document.file"), details: doc.filename },
                ...(doc.pages ? [{ term: say("document.pages"), details: String(doc.pages) }] : []),
                { term: say("document.size"), details: formatBytes(doc.sizeBytes, locale) },
                { term: say("document.added"), details: formatDate(doc.createdAt, locale, true) },
                { term: say("document.fingerprint"), details: <code className="break-all font-mono text-xs">{doc.sha256}</code> },
              ]}
            />
          </section>
        </Tabs.Content>

        <Tabs.Content value="verifications">
          <section aria-labelledby="checks" className="flex min-w-0 flex-col gap-4 pt-4">
            <div>
              <h2 id="checks" className="font-display text-lg font-bold text-fg">
                {say("document.checks")}
              </h2>
              <p className="text-sm text-fg-secondary">{say(`document.checksLeadBy.${wordingOf(perspective)}`)}</p>
            </div>
            {runningStudio ? <StepProgress step={runningStep} total={runningSteps.length} label={(step, total) => say("steps.progress", { step, total })} data-testid="run-progress" /> : null}
            <div className="grid gap-4 md:grid-cols-2">
              {(firstCheck(perspective, doc.kind) === "compliance-check" ? [complianceCard, authenticityCard] : [authenticityCard, complianceCard]).filter((c) => offer.studios.includes(c.key as Studio))}
            </div>
            {doc.analyses.map((a) => (
              <AnalysisCard key={a.id} documentId={doc.id} hasText={doc.hasText} source={doc.textSource} initial={a} selection={a.id === latestCompliance?.id ? selection : undefined} />
            ))}
          </section>
        </Tabs.Content>

        {isPdf ? (
          <Tabs.Content value="fichier">
            <section ref={viewerRef} aria-label={say("document.viewer")} className="min-w-0 pt-4">
              <DocumentViewer
                src={fileUrl}
                loadPdfjs={loadPdfjs}
                workerSrc={WORKER_SRC}
                highlights={highlights}
                activeId={activeId}
                onActiveChange={setActiveId}
                onLocate={setFound}
                className="[--kz-document-viewer-height:72vh]"
                labels={{ region: say("document.viewerRegion"), loading: say("document.loadingPdf"), failed: say("document.pdfFailed"), page: say("document.pageLabel"), onPage: say("document.onPage"), notFound: say("document.notFound") }}
              />
            </section>
          </Tabs.Content>
        ) : null}
        <Tabs.Content value="texte">
          <div className="pt-4">{doc.purged ? <Alert tone="info">{say("document.where.notKeptText")}</Alert> : doc.hasText ? <DocumentText text={doc.text} report={latestReport} /> : <Alert tone="info">{say("document.noText")}</Alert>}</div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
