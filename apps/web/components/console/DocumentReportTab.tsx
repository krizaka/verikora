"use client";

import { Footnotes } from "@krizaka/ui/footnote";
import { type Audience, checkSteps, type DocumentView, isSeededCheck } from "@verikora/core";
import type { ReactNode } from "react";

import { ClosingNoteView } from "@/components/ClosingNoteView";
import { CheckFailure } from "@/components/console/CheckFailure";
import { CheckSteps } from "@/components/console/CheckSteps";
import { buildNote, noteInputOf, noteSourceOf } from "@/lib/closing-note/build";
import { useSay } from "@/lib/i18n-client";
import type { LeaseBundle } from "@/lib/lease-bundle";
import { wordingOf } from "@/lib/perspective-defaults";
import type { RegistryReport } from "@/lib/registries/report";
import type { Answer } from "@/lib/signal-answers";

import { AuthenticitySignals } from "./AuthenticitySignals";
import type { DocumentFacts } from "./document-view-model";
import { LeaseBundleSection } from "./LeaseBundleSection";
import { OtherChecks } from "./OtherChecks";
import { RegistryChecks } from "./RegistryChecks";
import { ComplianceReportView, type FindingSelection, TechnicalDetails } from "./ReportFace";

/**
 * The report tab: where a running check stands, the runs that failed, then the verdict and the numbered findings (what failed
 * first), the authenticity signals, the engine's facts folded, the closing note, and the review and demo notes as footnotes; or the
 * authenticity report alone; or « Pas encore vérifié » with the checks to start. Once a report is shown, the other checks are
 * the aside's actions (design § 5.3): no form in this column.
 */
export function DocumentReportTab({
  doc,
  facts,
  selection,
  perspective,
  bundle = null,
  registry = null,
  answers,
  startCards,
}: Readonly<{
  doc: DocumentView;
  facts: DocumentFacts;
  selection: FindingSelection;
  perspective: Audience | null;
  bundle?: LeaseBundle | null;
  registry?: RegistryReport | null;
  answers?: Record<string, Answer>;
  startCards: ReactNode;
}>) {
  const { say, locale } = useSay();
  const { latestCompliance, latestReport, latestAuthenticity, runningStudio, failures } = facts;
  // The notes at the foot (design § 3.5): the review note first (the verdict points to it, REVIEW_NOTE), then a demo check's note — never a box above the report.
  const shown = latestCompliance && latestReport ? latestCompliance : latestAuthenticity;
  const notes = [
    ...(latestReport?.reviewStatus ? [say("analysis.toReview")] : []),
    ...(shown && isSeededCheck(shown) ? [say("analysis.seededNote")] : []),
  ];
  // The newest check decides: one that did not finish is said once, in plain words, with a way out; an older failure behind a report is history.
  const newest = doc.analyses[0];
  const failure = newest && failures.includes(newest) && !newest.report && !runningStudio ? newest : null;
  const body = () => {
    if (latestCompliance && latestReport) {
      return (
        <>
          <ComplianceReportView report={latestReport} analysis={latestCompliance} selection={selection} />
          <OtherChecks
            authenticity={latestAuthenticity}
            authenticityRunning={runningStudio === "document-authenticity"}
            authenticityFailed={failures.some((a) => a.studio === "document-authenticity")}
            registry={registry}
            answers={answers}
          />
          <details className="rounded-lg border border-border-default p-3">
            <summary className="cursor-pointer text-sm font-semibold text-fg">{say("document.details")}</summary>
            <div className="mt-3">
              <ClosingNoteView note={buildNote(noteInputOf(latestReport, noteSourceOf(doc.textSource)), locale)} />
            </div>
          </details>
        </>
      );
    }
    if (latestAuthenticity?.report && "signals" in latestAuthenticity.report) {
      return (
        <>
          <AuthenticitySignals report={latestAuthenticity.report} runId={latestAuthenticity.runId} answers={answers} />
          {registry ? <RegistryChecks report={registry} /> : null}
          <TechnicalDetails documentId={doc.id} analysis={latestAuthenticity} />
        </>
      );
    }
    return (
      <>
        {failure ? null : (
          <div>
            <h2 className="font-display text-lg font-bold text-fg">{say("reportFace.notChecked")}</h2>
            <p className="text-sm text-fg-secondary">{say(`document.checksLeadBy.${wordingOf(perspective)}`)}</p>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">{startCards}</div>
      </>
    );
  };
  return (
    <section
      aria-label={say("document.tabs.rapport")}
      className="flex min-w-0 flex-col gap-4"
      data-testid="tab-rapport"
    >
      {runningStudio ? (
        <CheckSteps
          steps={checkSteps({ hasText: doc.hasText, analysis: { studio: runningStudio, status: "running" } })}
        />
      ) : null}
      {failure ? <CheckFailure doc={doc} failed={failure} /> : null}
      {body()}
      {bundle && bundle.documents.length > 1 ? <LeaseBundleSection bundle={bundle} /> : null}
      <p className="m-0 text-xs text-fg-muted">{say("library.informative")}</p>
      {notes.length ? (
        <Footnotes
          className="[&_ol]:list-decimal"
          notes={notes}
          label={say("reportFace.notes")}
          backLabel={say("reportFace.backToText")}
        />
      ) : null}
    </section>
  );
}
