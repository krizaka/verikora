"use client";

import type { ComplianceReport } from "@verikora/core";

import { FindingList, VerdictBand } from "@/components/console/ReportFace";

/** The two parts of the console's report, as they are in the app: the verdict, then the findings that need a look (the first three). */
export function FindingsLive({ report }: Readonly<{ report: ComplianceReport }>) {
  const failed = report.findings.filter((f) => f.verdict !== "PASS").slice(0, 3);
  return (
    <div className="flex flex-col gap-3 p-4">
      <VerdictBand report={report} />
      <FindingList report={{ ...report, findings: failed }} />
    </div>
  );
}
