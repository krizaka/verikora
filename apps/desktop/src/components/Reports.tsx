import { DebriefIcon } from "@krizaka/icons";
import { useQuery } from "@krizaka/query";
import { Badge } from "@krizaka/ui/badge";
import { EmptyState } from "@krizaka/ui/empty-state";
import { List } from "@krizaka/ui/list";
import { ANALYSIS_STATUS, type AnalysisStatus } from "@verikora/core";

import { useI18n } from "../i18n";
import { queries } from "../lib/config";
import { hashOf, type Route } from "../lib/route";

/** The documents checked, newest first: each opens its checks and their signed reports. The files stayed on the Mac. */
export function ReportsView({ go: _go }: Readonly<{ go: (route: Route) => void }>) {
  const { t, locale } = useI18n();
  const documents = useQuery(queries.documents());
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-fg-secondary">{t("reports.lead")}</p>
      {/* Query keeps the last answer beside an error: an empty list reads as « nothing checked » only when the last read succeeded. */}
      {documents.data?.length === 0 && !documents.isError ? (
        <EmptyState icon={<DebriefIcon size={28} />} title={t("reports.title")} description={t("reports.empty")} />
      ) : (
        <List
          aria-label={t("reports.title")}
          items={documents.data ?? []}
          getId={(d) => d.id}
          loading={documents.isPending}
          chevrons
          error={documents.isError ? t("common.offline") : undefined}
          row={(d) => ({
            title: d.title || d.filename,
            description: when(d.createdAt),
            href: hashOf({ screen: "document", documentId: d.id }),
          })}
        />
      )}
    </div>
  );
}

/** An analysis's status, as the stepper's words and a badge's tone. */
const SHOWN: Record<AnalysisStatus, { state: "done" | "current" | "error"; tone: "success" | "accent" | "danger" }> = {
  [ANALYSIS_STATUS.succeeded]: { state: "done", tone: "success" },
  [ANALYSIS_STATUS.running]: { state: "current", tone: "accent" },
  [ANALYSIS_STATUS.failed]: { state: "error", tone: "danger" },
  [ANALYSIS_STATUS.cancelled]: { state: "error", tone: "danger" },
};

/** One document's checks: each opens its stages, its note and its signed report. */
export function DocumentView({ documentId, go: _go }: Readonly<{ documentId: string; go: (route: Route) => void }>) {
  const { t, locale } = useI18n();
  const document = useQuery(queries.document(documentId));
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">
        {document.data ? document.data.title || document.data.filename : t("reports.title")}
      </h1>
      <h2 className="text-sm font-semibold">{t("reports.checks")}</h2>
      <List
        aria-label={t("reports.checks")}
        items={document.data?.analyses ?? []}
        getId={(a) => a.id}
        loading={document.isPending}
        chevrons
        error={document.isError ? t("common.offline") : undefined}
        empty={<p className="text-fg-secondary">{t("reports.none")}</p>}
        row={(a) => ({
          title: t(a.studio === "compliance-check" ? "check.compliance" : "check.authenticity"),
          description: when(a.createdAt),
          href: hashOf({ screen: "check", documentId, analysisId: a.id }),
          meta: <Badge tone={SHOWN[a.status].tone}>{t(`steps.state.${SHOWN[a.status].state}`)}</Badge>,
        })}
      />
    </div>
  );
}
