import { useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { EmptyState } from "@krizaka/ui/empty-state";
import { List } from "@krizaka/ui/list";
import { Progress } from "@krizaka/ui/progress";
import { BatchIcon } from "@krizaka/icons";
import { BATCH_ITEM, type BatchItemState } from "@verikora/core";

import { useI18n } from "../i18n";
import { queries } from "../lib/config";
import { hashOf, type Route } from "../lib/route";
import { keptOnMac } from "../lib/use-batch";

const TONE: Record<BatchItemState, "neutral" | "accent" | "success" | "danger" | "warning"> = {
  [BATCH_ITEM.pending]: "neutral",
  [BATCH_ITEM.reused]: "success",
  [BATCH_ITEM.running]: "accent",
  [BATCH_ITEM.done]: "success",
  [BATCH_ITEM.failed]: "danger",
  [BATCH_ITEM.refused]: "warning",
};

const FINISHED: ReadonlySet<BatchItemState> = new Set([
  BATCH_ITEM.done,
  BATCH_ITEM.reused,
  BATCH_ITEM.failed,
  BATCH_ITEM.refused,
]);

/** The batches of the account, newest first. */
export function BatchesView({ go: _go }: Readonly<{ go: (route: Route) => void }>) {
  const { t, locale } = useI18n();
  const list = useQuery(queries.batches());
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-fg-secondary">{t("batch.lead")}</p>
      {/* Query keeps the last answer beside an error: an empty list reads as « no batch » only when the last read succeeded. */}
      {list.data?.length === 0 && !list.isError ? (
        <EmptyState icon={<BatchIcon size={28} />} title={t("batch.title")} description={t("batch.empty")} />
      ) : (
        <List
          aria-label={t("batch.title")}
          items={list.data ?? []}
          getId={(b) => b.id}
          loading={list.isPending}
          chevrons
          error={list.isError ? t("common.offline") : undefined}
          row={(b) => ({
            title: b.name,
            description: when(b.createdAt),
            href: hashOf({ screen: "batch", batchId: b.id }),
            meta: (
              <Badge tone={b.finishedAt ? "success" : "accent"}>
                {t("batch.progress", { done: b.done, total: b.items })}
              </Badge>
            ),
          })}
        />
      )}
    </div>
  );
}

/** A batch being followed: each read advances it; a finished row opens its check. */
export function BatchView({ batchId, go: _go }: Readonly<{ batchId: string; go: (route: Route) => void }>) {
  const { t } = useI18n();
  const batch = useQuery(queries.batch(batchId));
  const data = batch.data;
  const total = data?.items.length ?? 0;
  const finished = data ? data.items.filter((i) => FINISHED.has(i.state)).length : 0;
  const kept = keptOnMac.get(batchId) ?? 0;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{data?.name ?? t("batch.title")}</h1>
      <Progress
        value={total ? Math.round((finished / total) * 100) : undefined}
        label={t("batch.progress", { done: finished, total })}
      />
      <p className="text-sm text-fg-secondary">{t("batch.progress", { done: finished, total })}</p>
      {kept > 0 ? <Alert tone="warning">{t("batch.refusedHere", { count: kept })}</Alert> : null}
      {data?.pausedBy ? <Alert tone="warning">{t("batch.paused", { reason: data.pausedBy })}</Alert> : null}
      <List
        aria-label={data?.name ?? t("batch.title")}
        items={data?.items ?? []}
        getId={(i) => i.id}
        loading={batch.isPending}
        error={batch.isError ? t("common.offline") : undefined}
        row={(i) => ({
          title: i.file,
          description: i.error ?? undefined,
          href:
            i.documentId && i.analysisId && FINISHED.has(i.state)
              ? hashOf({ screen: "check", documentId: i.documentId, analysisId: i.analysisId })
              : undefined,
          meta: <Badge tone={TONE[i.state]}>{t(`batch.state.${i.state}`)}</Badge>,
        })}
      />
    </div>
  );
}
