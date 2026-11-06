"use client";

import { Badge } from "@krizaka/ui/badge";
import type { DocumentView } from "@verikora/core";
import Link from "next/link";

import { useSay } from "@/lib/i18n-client";

import { type DocumentFacts, isComplianceReport } from "./document-view-model";
import { formatDate } from "./format";
import { TechnicalDetails } from "./ReportFace";

const RUN_TONE = { running: "accent", succeeded: "success", failed: "danger", cancelled: "neutral" } as const;

/** The history tab: every run of the document, newest first; a compliance run opens its own report (`?run=`). */
export function DocumentHistoryTab({
  doc,
  path,
  latestCompliance,
}: Readonly<{ doc: DocumentView; path: string; latestCompliance: DocumentFacts["latestCompliance"] }>) {
  const { say, locale } = useSay();
  return (
    <section
      aria-label={say("document.tabs.historique")}
      className="flex min-w-0 flex-col gap-3"
      data-testid="tab-historique"
    >
      <p className="m-0 text-sm text-fg-secondary">
        {doc.analyses.length > 1 ? say("reportFace.history") : say("reportFace.oneRun")}
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {doc.analyses.map((a) => (
          <li
            key={a.id}
            className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-1 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-fg">
                {say(a.studio === "compliance-check" ? "analysis.complianceTitle" : "analysis.authenticityTitle")}
              </span>
              <Badge tone={RUN_TONE[a.status]}>{say(`analysis.statuses.${a.status}`)}</Badge>
            </div>
            <span className="text-xs text-fg-muted">{formatDate(a.createdAt, locale, true)}</span>
            {isComplianceReport(a) ? (
              <Link
                href={`${path}/rapport?run=${a.id}`}
                scroll={false}
                aria-current={latestCompliance?.id === a.id ? "true" : undefined}
                className="text-sm font-semibold text-fg-accent hover:underline"
                data-testid="open-run"
              >
                {say("reportFace.openRun")}
              </Link>
            ) : null}
            <TechnicalDetails documentId={doc.id} analysis={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}
