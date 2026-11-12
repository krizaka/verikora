"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { AnalysisReport, type AnalysisReportLabels } from "@krizaka/ui/analysis-report";
import { DescriptionList } from "@krizaka/ui/description-list";
import { FootnoteRef } from "@krizaka/ui/footnote";
import { Stat } from "@krizaka/ui/stat";
import { type Analysis, type ComplianceReport, type Finding, isSeededCheck, queryKeys } from "@verikora/core";
import { z } from "zod";

import { analysisFindings, analysisStatusOfTone, overallKeyOfTone } from "@/lib/analysis-report-map";
import { numberFindings, verdictOf } from "@/lib/document-face";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { formatDate } from "./format";

/** The note the verdict points to when the rules still await a lawyer's reading: the first footnote of the report (design § 5.3). */
export const REVIEW_NOTE = 1;

/** What the document page shares with the findings of its latest compliance check: which finding is lit, and where each sits. */
export interface FindingSelection {
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * The compliance report, drawn by `AnalysisReport` of @krizaka/ui (krizaka-internal#2293): the verdict first (how many rules of how many
 * need a look and how many block, with the law's context in words — never Verikora's own verdict), the findings by gravity each with the
 * passage it rests on and its article, what was met and what does not apply folded, the run in one fold. The review note is a footnote
 * at the foot of the report, pointed to from here. `shown` is a subset of the findings (the home's three); the verdict stays the report's.
 */
export function ComplianceReportView({
  report,
  analysis,
  selection,
  shown,
}: Readonly<{
  report: ComplianceReport;
  analysis?: Analysis;
  selection?: FindingSelection;
  shown?: readonly Finding[];
}>) {
  const { say, locale } = useSay();
  if (report.outcome === "UNSUPPORTED_KIND" || report.outcome === "KIND_UNKNOWN") {
    return (
      <section
        aria-label={say("reportFace.label")}
        className="rounded-lg border border-border-default bg-surface-1 p-4"
        data-testid="verdict-band"
        data-tone="neutral"
      >
        <Stat
          label={say("reportFace.label")}
          value={say(`reportFace.unchecked.${report.outcome}.title`)}
          hint={say(`reportFace.unchecked.${report.outcome}.hint`)}
        />
      </section>
    );
  }
  const v = verdictOf(report);
  const value = v.attention
    ? say(pluralKey("reportFace.attention", v.attention), { count: v.attention, rules: v.rules })
    : say("reportFace.attentionNone", { rules: v.rules });
  const context = say("reportFace.rulesOf", {
    jurisdiction: say(`analysis.jurisdictionNames.${report.jurisdiction}`),
    date: formatDate(report.asOf, locale),
  });
  const { findings, ruleIdOf } = analysisFindings(shown ?? report.findings, say, locale, Boolean(selection));
  const labelKeys = [
    "findings",
    "mayIndicate",
    "evidence",
    "details",
    "limits",
    "nextSteps",
    "provenance",
    "model",
    "runId",
    "duration",
    "version",
    "copyJson",
    "copyMarkdown",
    "copied",
    "streaming",
    "noFindings",
  ] as const;
  const labels: AnalysisReportLabels = {
    ...(Object.fromEntries(labelKeys.map((k) => [k, say(`reportFace.analysis.${k}`)])) as Omit<
      AnalysisReportLabels,
      "status" | "location"
    >),
    // The location is the one action « See in the file »: its words are the button's, so the label is empty.
    location: "",
    status: {
      inconsistent: say("reportFace.analysis.status.inconsistent"),
      attention: say("reportFace.analysis.status.attention"),
      unverified: say("reportFace.analysis.status.unverified"),
      consistent: say("reportFace.analysis.status.consistent"),
    },
  };
  const ruleset = analysis?.report && "rulesetId" in analysis.report ? analysis.report : null;
  const provenance = analysis
    ? {
        ...(ruleset ? { model: `${ruleset.rulesetId} · ${ruleset.rulesetVersion}` } : {}),
        ...(analysis.runId ? { runId: analysis.runId } : {}),
        ...(analysis.blueprintVersion ? { version: `${analysis.studio} · ${analysis.blueprintVersion}` } : {}),
      }
    : undefined;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 [&_header_.flex-wrap>:first-child]:hidden [&_p]:[overflow-wrap:anywhere] [&_summary]:flex [&_summary]:min-h-11 [&_summary]:items-center [&_button]:min-h-11"
      data-testid="compliance-report"
      data-tone={v.tone}
    >
      <AnalysisReport
        title={say("reportFace.label")}
        summary={`${say(overallKeyOfTone(v.tone))} · ${value} · ${context}`}
        status={analysisStatusOfTone(v.tone)}
        findings={findings}
        labels={labels}
        hideActions
        folded={["unverified", "consistent"]}
        provenance={provenance}
        provenanceFolded
        onLocate={
          selection
            ? (f) => {
                const ruleId = ruleIdOf.get(f.id);
                if (ruleId) {
                  selection.onSelect(selection.activeId === ruleId ? null : ruleId);
                }
              }
            : undefined
        }
      />
      {report.reviewStatus ? (
        <p className="m-0 text-xs text-fg-muted">
          {say("reportFace.reviewPending")}
          <FootnoteRef n={REVIEW_NOTE} />
        </p>
      ) : null}
    </div>
  );
}

const reportMeta = z.object({ report: z.object({ fileSha256: z.string(), keyId: z.string(), filename: z.string() }) });

/** The report's fingerprint and key, from the server, for a check that can be certified (a seeded demo check cannot). */
export function useReportMeta(documentId: string, analysis: Analysis, locale: string) {
  const certifiable =
    analysis.studio === "compliance-check" &&
    analysis.status === "succeeded" &&
    !!analysis.report &&
    "findings" in analysis.report &&
    !isSeededCheck(analysis);
  return useQuery({
    queryKey: [...queryKeys.document(documentId), "report", analysis.id, locale],
    queryFn: () =>
      krizakaFetch(`/api/documents/${documentId}/analyses/${analysis.id}/report?lang=${locale}&meta=1`, {
        schema: reportMeta,
      }).then((r) => r.report),
    staleTime: Infinity,
    retry: false,
    throwOnError: false,
    enabled: certifiable,
  });
}

/** The engine's facts, folded (the review's D1, D2): the run id — once, here —, the Studio version, the rules, each finding's rule id and method by its number, the dates, the report's fingerprint and key. */
export function TechnicalDetails({ documentId, analysis }: Readonly<{ documentId: string; analysis: Analysis }>) {
  const { say, locale } = useSay();
  const meta = useReportMeta(documentId, analysis, locale);
  const report = analysis.report && "rulesetId" in analysis.report ? analysis.report : null;
  const numbered = report && "findings" in report ? numberFindings(report.findings) : null;
  const byNumber = numbered ? [...numbered.attention, ...numbered.passed, ...numbered.notApplicable] : [];
  return (
    <details className="rounded-lg border border-border-default p-3" data-testid="technical-details">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-fg">
        {say("reportFace.technical")}
      </summary>
      <div className="mt-3">
        <DescriptionList
          items={[
            {
              term: say("analysis.runId"),
              details: (
                <code className="break-all font-mono text-xs" data-testid="sovkora-run-id">
                  {analysis.runId ?? "—"}
                </code>
              ),
            },
            ...(analysis.blueprintVersion
              ? [{ term: say("analysis.blueprint"), details: `${analysis.studio} · ${analysis.blueprintVersion}` }]
              : []),
            ...(report
              ? [{ term: say("analysis.ruleset"), details: `${report.rulesetId} · ${report.rulesetVersion}` }]
              : []),
            ...(byNumber.length
              ? [
                  {
                    term: say("reportFace.rules"),
                    details: (
                      <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
                        {byNumber.map(({ n, finding: f }) => (
                          <li key={f.ruleId}>
                            <code className="break-all font-mono">
                              {[n, f.ruleId, f.method].filter(Boolean).join(" · ")}
                            </code>
                          </li>
                        ))}
                      </ol>
                    ),
                  },
                ]
              : []),
            { term: say("analysis.started"), details: formatDate(analysis.createdAt, locale, true) },
            ...(analysis.finishedAt
              ? [{ term: say("analysis.finished"), details: formatDate(analysis.finishedAt, locale, true) }]
              : []),
            ...(meta.data
              ? [
                  {
                    term: say("analysis.exportSha"),
                    details: (
                      <code className="break-all font-mono text-xs" data-testid="report-sha256">
                        {meta.data.fileSha256}
                      </code>
                    ),
                  },
                  {
                    term: say("analysis.exportKey"),
                    details: <code className="font-mono text-xs">{meta.data.keyId}</code>,
                  },
                ]
              : []),
          ]}
        />
      </div>
    </details>
  );
}
