import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { useMutation, useQuery } from "@krizaka/query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { stepperSteps } from "@verikora/client";
import { ANALYSIS_STATUS, checkSteps } from "@verikora/core";
import { Stepper } from "@krizaka/ui/stepper";

import { type MessageKey, useI18n } from "../i18n";
import { queries, verikora } from "../lib/config";
import { localDocuments } from "../lib/local-documents";
import { base64Of, verikoraNative } from "../lib/desktop";
import { type Route } from "../lib/route";
import { ClosingNote } from "./ClosingNote";

type Locale = ReturnType<typeof useI18n>["locale"];

/** The signed report, saved next to the document it is about. */
function useReportSave(documentId: string, analysisId: string, locale: Locale) {
  return useMutation({
    mutationFn: async () => {
      const { url, headers } = await verikora.reportRequest(documentId, analysisId, locale);
      const res = await tauriFetch(url, { headers });
      if (!res.ok) throw new Error(String(res.status));
      const path = localDocuments.pathOf(documentId);
      if (!path) throw new Error("the document's file is not known on this Mac");
      return verikoraNative.saveReport(
        path,
        `verikora-audit-${analysisId.slice(0, 8)}.pdf`,
        base64Of(new Uint8Array(await res.arrayBuffer())),
      );
    },
  });
}

/** The save action of a compliance check's report, and what came of it. */
function ReportSave({
  documentId,
  analysisId,
  locale,
}: Readonly<{ documentId: string; analysisId: string; locale: Locale }>) {
  const { t } = useI18n();
  const save = useReportSave(documentId, analysisId, locale);
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
        {save.isPending ? t("report.saving") : t("report.save")}
      </Button>
      {save.isSuccess ? (
        <Alert tone="success">{t("report.saved", { name: save.data.split("/").pop() ?? "" })}</Alert>
      ) : null}
      {save.isError ? <Alert tone="danger">{t("report.failed")}</Alert> : null}
      <p className="text-xs text-fg-muted">{t("result.signed")}</p>
    </div>
  );
}

/** A check being followed: its stages, then the plain-language note, and the signed report saved next to the document. */
export function CheckView({
  documentId,
  analysisId,
  go,
}: Readonly<{ documentId: string; analysisId: string; go: (route: Route) => void }>) {
  const { t, locale } = useI18n();
  const run = useQuery(queries.analysis(documentId, analysisId, locale));
  const found = run.data?.analysis ?? null;
  // A run exists only for a document whose text was read (or a file the authenticity check reads as is).
  const steps = checkSteps({
    hasText: true,
    analysis: found ? { studio: found.studio, status: found.status } : null,
    studio: found?.studio,
  });
  const working = steps.some((step) => step.state === "current");
  const failed =
    found !== null && found.status !== ANALYSIS_STATUS.running && found.status !== ANALYSIS_STATUS.succeeded;
  return (
    <div className="flex max-w-3xl flex-col gap-5" data-testid="check-view" data-status={found?.status ?? "pending"}>
      <Button variant="ghost" size="sm" className="self-start" onClick={() => go({ screen: "library", folder: null })}>
        {t("check.back")}
      </Button>
      <Stepper
        aria-label={t("steps.label")}
        orientation="horizontal"
        steps={stepperSteps(steps, (key) => t(key as MessageKey))}
        labels={{
          done: t("steps.state.done"),
          current: t("steps.state.current"),
          upcoming: t("steps.state.upcoming"),
          error: t("steps.state.error"),
        }}
      />
      {working ? <p className="text-fg-secondary">{t("result.runningHint")}</p> : null}
      {found?.runId ? (
        <p className="break-all text-xs tabular-nums text-fg-muted">{t("check.run", { runId: found.runId })}</p>
      ) : null}
      {failed ? <Alert tone="danger">{found.error ?? t("result.failedHint")}</Alert> : null}
      {run.data?.closingNote ? (
        <div className="flex flex-col gap-5" data-testid="check-result">
          <ClosingNote note={run.data.closingNote} />
          {found?.studio === "compliance-check" ? (
            <ReportSave documentId={documentId} analysisId={analysisId} locale={locale} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
