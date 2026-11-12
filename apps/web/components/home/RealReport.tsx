"use client";

import { Footnotes } from "@krizaka/ui/footnote";
import type { ComplianceReport } from "@verikora/core";

import { ComplianceReportView } from "@/components/console/ReportFace";
import type { Locale } from "@/lib/i18n";
import type { ConsoleMessages } from "@/lib/i18n-client";
import { I18nProvider, useSay } from "@/lib/i18n-client";

/**
 * The recorded report itself (krizaka-internal#2562, slice C), drawn by the app's own `ComplianceReportView` (`AnalysisReport` of
 * @krizaka/ui through `lib/analysis-report-map`): the findings with their quote and article, the met and not-applicable rules folded.
 * Nothing is mapped here: the words are the app's, the figures are the run's.
 */
export function RealReport({
  locale,
  messages,
  report,
}: Readonly<{ locale: Locale; messages: ConsoleMessages; report: ComplianceReport }>) {
  return (
    <I18nProvider locale={locale} messages={messages}>
      <ComplianceReportView report={report} />
      {report.reviewStatus ? <ReviewNote /> : null}
    </I18nProvider>
  );
}

/** The note the verdict points to (the app's own, at the foot of the report): the rules still await a lawyer's reading. */
function ReviewNote() {
  const { say } = useSay();
  return (
    <Footnotes
      className="mt-2 [&_ol]:list-decimal"
      notes={[say("analysis.toReview")]}
      label={say("reportFace.notes")}
      backLabel={say("reportFace.backToText")}
    />
  );
}
