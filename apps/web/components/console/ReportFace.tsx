"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { DescriptionList } from "@krizaka/ui/description-list";
import { FootnoteRef } from "@krizaka/ui/footnote";
import { Stat } from "@krizaka/ui/stat";
import { type Analysis, type ComplianceReport, isSeededCheck, queryKeys } from "@verikora/core";
import { z } from "zod";

import {
  NOT_APPLICABLE,
  type NumberedFinding,
  numberFindings,
  severityOf,
  verdictOf,
  type VerdictTone,
} from "@/lib/document-face";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";
import { ruleExplanation, ruleTitle } from "@/lib/rule-text";

import { formatDate } from "./format";

const BAND: Record<VerdictTone, string> = {
  success: "rounded-lg border border-border-default border-l-4 border-l-success bg-surface-1 p-4",
  warning: "rounded-lg border border-border-default border-l-4 border-l-warning bg-surface-1 p-4",
  danger: "rounded-lg border border-border-default border-l-4 border-l-danger bg-surface-1 p-4",
};
const CHIP: Record<VerdictTone | "neutral", "success" | "warning" | "danger" | "neutral"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
};

/** The note the verdict points to when the rules still await a lawyer's reading: the first footnote of the report (design § 5.3). */
export const REVIEW_NOTE = 1;

/**
 * The verdict first (the review's D1, design § 5.3): how many rules of how many need a look and how many of them block, in the
 * report's tone, with the law's context in words — the ruleset's id stays in the technical details; never Verikora's own verdict.
 * The review note is a footnote at the foot of the report, pointed to from here.
 */
export function VerdictBand({ report }: Readonly<{ report: ComplianceReport }>) {
  const { say, locale } = useSay();
  if (report.outcome === "UNSUPPORTED_KIND" || report.outcome === "KIND_UNKNOWN") {
    return (
      <section
        aria-label={say("reportFace.label")}
        className="rounded-lg border border-border-default border-l-4 border-l-border-strong bg-surface-1 p-4"
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
  const hint = (
    <>
      {v.blocking ? `${say(pluralKey("reportFace.blocking", v.blocking), { count: v.blocking })} · ` : null}
      {context}
      {report.reviewStatus ? <FootnoteRef n={REVIEW_NOTE} /> : null}
    </>
  );
  return (
    <section
      aria-label={say("reportFace.label")}
      className={BAND[v.tone]}
      data-testid="verdict-band"
      data-tone={v.tone}
    >
      <Stat label={say("reportFace.label")} value={value} hint={hint} />
    </section>
  );
}

/** What the document page shares with the findings of its latest compliance check: which finding is lit, and where each sits. */
export interface FindingSelection {
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * The findings, numbered in reading order (the review's D1, D2, design § 5.3): what needs a look first, each with its number, its
 * title, its severity as a word, the quote it rests on (or that none is quoted), the explanation and the article; what passed is
 * folded and numbered on. The rule's id and the method stay in the technical details.
 */
export function FindingList({
  report,
  selection,
}: Readonly<{ report: ComplianceReport; selection?: FindingSelection }>) {
  const { say, locale } = useSay();
  const { attention, passed, notApplicable } = numberFindings(report.findings);
  const item = ({ n, finding: f, anchor }: NumberedFinding) => {
    const s = severityOf(f.severity);
    const active = selection?.activeId === f.ruleId;
    const failed = f.verdict !== "PASS" && f.verdict !== NOT_APPLICABLE;
    return (
      <li
        key={anchor}
        id={anchor}
        data-active={active}
        className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 rounded-lg border border-border-default bg-surface-1 p-3 text-sm data-[active=true]:border-accent data-[active=true]:bg-surface-2"
      >
        <span aria-hidden="true" className="text-lg font-bold tabular-nums text-accent">
          {n}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-fg">
              {f.title ? ruleTitle(f.ruleId, locale, f.title) : say("reportFace.rule", { n })}
            </span>
            {failed ? (
              <span className="flex items-center gap-2">
                <Badge tone={CHIP[s.tone]}>{say(`analysis.severities.${s.word}`)}</Badge>
                {f.verdict === "INSUFFICIENT_EVIDENCE" ? (
                  <Badge tone="warning">{say("analysis.verdicts.INSUFFICIENT_EVIDENCE")}</Badge>
                ) : null}
              </span>
            ) : null}
          </div>
          {f.evidenceSpan?.quote ? <p className="m-0 italic text-fg-secondary">« {f.evidenceSpan.quote} »</p> : null}
          {!f.evidenceSpan?.quote && failed ? <p className="m-0 text-fg-muted">{say("reportFace.noQuote")}</p> : null}
          <p className="m-0 text-fg-secondary [overflow-wrap:anywhere]">
            {ruleExplanation(f.ruleId, locale, f.explanation, f.explanationEn)}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            {f.citation ? <span data-testid="finding-citation">{f.citation}</span> : null}
            {selection && f.evidenceSpan?.quote ? (
              <Button
                size="sm"
                variant={active ? "primary" : "ghost"}
                aria-pressed={active}
                onClick={() => selection.onSelect(active ? null : f.ruleId)}
              >
                {say("reportFace.seeInFile")}
              </Button>
            ) : null}
          </div>
        </div>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-3" data-testid="finding-list">
      {attention.length ? <ol className="m-0 flex list-none flex-col gap-2 p-0">{attention.map(item)}</ol> : null}
      {passed.length ? (
        <details className="rounded-lg border border-border-default p-3" data-testid="passed-findings">
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            {say(pluralKey("reportFace.passed", passed.length), { count: passed.length })}
          </summary>
          <ol start={attention.length + 1} className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {passed.map(item)}
          </ol>
        </details>
      ) : null}
      {notApplicable.length ? (
        <details className="rounded-lg border border-border-default p-3" data-testid="not-applicable-findings">
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            {say(pluralKey("reportFace.notApplicable", notApplicable.length), { count: notApplicable.length })}
          </summary>
          <ol start={attention.length + passed.length + 1} className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {notApplicable.map(item)}
          </ol>
        </details>
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
      <summary className="cursor-pointer text-sm font-semibold text-fg">{say("reportFace.technical")}</summary>
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
