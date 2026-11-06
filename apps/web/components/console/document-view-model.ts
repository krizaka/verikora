import type { Located } from "@krizaka/ui/document-viewer";
import {
  type Analysis,
  ANALYSIS_STATUS,
  type ComplianceReport,
  DOCUMENT_TABS,
  type DocumentKind,
  type DocumentView,
  DOCX_MIME,
  isSeededCheck,
  ODT_MIME,
  type Studio,
} from "@verikora/core";

import type { CheckPlan } from "@/lib/check-flow";
import type { DocumentTab } from "@/lib/console-nav";
import { type CheckKind, isCheckKind } from "@/lib/rulesets";

/* Pure (no React, no fetch): what the document page derives from a document and its address (verikora#320, #110). */

type Say = (key: string, vars?: Record<string, string | number>) => string;

const STUDIOS_SHOWN_RUNNING = ["compliance-check", "document-authenticity"] as const;

export const isComplianceReport = (a: Analysis): boolean =>
  a.studio === "compliance-check" && !!a.report && "findings" in a.report;

export interface DocumentFacts {
  /** The compliance check on the face: the run the history opened (`?run=`), else the latest. */
  latestCompliance: Analysis | undefined;
  latestAuthenticity: Analysis | undefined;
  /** The face's compliance report, when it has findings. */
  latestReport: ComplianceReport | null;
  failures: Analysis[];
  running: (studio: Studio) => boolean;
  /** The Studio whose run is followed at the top of the report (its steps). */
  runningStudio: (typeof STUDIOS_SHOWN_RUNNING)[number] | null;
  isPdf: boolean;
  /** A file the authenticity Studio reads: a PDF, a Word or an OpenDocument file. */
  examinable: boolean;
  /** A report is on the face (a compliance report with findings, or the authenticity signals): the other checks move to the aside. */
  reported: boolean;
  /** The Studios that already answered on this document (« Revérifier » rather than « Vérifier »). */
  done: Studio[];
  /** A real run (never the demo seed's) has a signed report. */
  certifiable: boolean;
  reportHref: string | null;
  /** The tabs shown: the history only with more than one run. */
  tabs: DocumentTab[];
}

export function documentFacts(
  doc: Pick<DocumentView, "id" | "mimeType" | "analyses">,
  { run, locale }: { run: string | null; locale: string },
): DocumentFacts {
  const latestCompliance =
    (run ? doc.analyses.find((a) => a.id === run && isComplianceReport(a)) : undefined) ??
    doc.analyses.find(isComplianceReport);
  const latestAuthenticity = doc.analyses.find(
    (a) => a.studio === "document-authenticity" && a.report && "signals" in a.report,
  );
  const running = (studio: Studio) =>
    doc.analyses.some((a) => a.studio === studio && a.status === ANALYSIS_STATUS.running);
  const isPdf = doc.mimeType === "application/pdf";
  const latestReport =
    latestCompliance?.report && "findings" in latestCompliance.report ? latestCompliance.report : null;
  return {
    latestCompliance,
    latestAuthenticity,
    latestReport,
    reported: !!(latestCompliance && latestReport) || !!latestAuthenticity,
    done: [
      ...(latestReport ? (["compliance-check"] as const) : []),
      ...(latestAuthenticity ? (["document-authenticity"] as const) : []),
    ],
    failures: doc.analyses.filter((a) => a.error),
    running,
    runningStudio: STUDIOS_SHOWN_RUNNING.find((s) => running(s)) ?? null,
    isPdf,
    examinable: isPdf || doc.mimeType === DOCX_MIME || doc.mimeType === ODT_MIME,
    certifiable: !!latestCompliance && !isSeededCheck(latestCompliance),
    reportHref: latestCompliance
      ? `/api/documents/${doc.id}/analyses/${latestCompliance.id}/report?lang=${locale}`
      : null,
    tabs: DOCUMENT_TABS.filter((t) => t !== "historique" || doc.analyses.length > 1),
  };
}

/** The passages the viewer lights: each finding that quotes the file, under its title. */
export const highlightsOf = (report: ComplianceReport | null): { id: string; quote: string; label: string }[] =>
  (report?.findings ?? [])
    .filter((f) => f.evidenceSpan?.quote)
    .map((f) => ({ id: f.ruleId, quote: f.evidenceSpan!.quote, label: f.title ?? f.ruleId }));

/** The kinds the compliance form offers: a lease always, then each kind whose ruleset the person's flows name. */
export function offeredKinds(rulesets: readonly string[]): CheckKind[] {
  return [
    "lease",
    ...(rulesets.includes("qc-invoice") ? (["invoice"] as const) : []),
    ...(rulesets.includes("qc-service-contract") ? (["contract"] as const) : []),
    ...(rulesets.includes("qc-visit-notice") ? (["visit-notice"] as const) : []),
    ...(rulesets.includes("qc-premises-condition") ? (["premises-condition"] as const) : []),
  ];
}

/** On a mismatch, the detected kind and the declared one join the offer (once each), so the person confirms one of them. */
export function complianceOptions(
  mismatch: CheckPlan["mismatch"],
  offered: readonly CheckKind[],
  declared: DocumentKind,
): readonly CheckKind[] {
  return mismatch
    ? [...new Set<CheckKind>([...offered, mismatch.detected, ...(isCheckKind(declared) ? [declared] : [])])]
    : offered;
}

/** Where Sovkora's finding sits in the file, in words — never a place the PDF's text layer did not confirm. */
export function placeOf(found: Located | null | undefined, say: Say): string | null {
  if (found === undefined) return null;
  if (found === null) return say("analysis.findingNotFound");
  return found.match === "page"
    ? say("analysis.findingPageOnly", { page: found.page })
    : say("analysis.findingPage", { page: found.page });
}
