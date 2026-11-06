import { useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Badge, Button, Card, DescriptionList, EmptyState, Header, Screen, Segmented, Txt } from "@krizaka/ui/native";
import { availableChecks, CHECK, type DocumentDetail, keys, type Locale } from "@verikora/client";
import type { Analysis } from "@verikora/core";
import { ANALYSIS_STATUS, checkSteps } from "@verikora/core";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { queries, verikora } from "@/config";
import { deviceStore } from "@/data/expo-files";
import { legacyDocumentHref, routes } from "@/domain/links";
import { useI18n } from "@/i18n";
import { shareSignedReport } from "@/report";
import { CheckProgress } from "@/ui/CheckProgress";
import { ClosingNote } from "@/ui/ClosingNote";
import { useLocale } from "@/use-locale";

/** The tabs this app draws of the web's three (`historique` stays on the web), each its own route — the same addresses. */
const TABS = ["rapport", "document"] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string): value is Tab => (TABS as readonly string[]).includes(value);

const CHECK_LABEL = { [CHECK.compliance]: "check.compliance", [CHECK.authenticity]: "check.authenticity" } as const;

/** One document, one tab per route, like the web; the check being followed is `?analysis=`. */
export default function DocumentScreen() {
  const { id, tab, analysis } = useLocalSearchParams<{ id: string; tab: string; analysis?: string }>();
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  const document = useQuery(queries.document(id));

  // An old address (`infos`, `verifications`…) opens its tab, as the web answers 308; anything else opens the report.
  if (!isTab(tab)) return <Redirect href={legacyDocumentHref(locale, id, tab, analysis) as never} />;

  return (
    <Screen
      header={
        <Header
          title={document.data?.title ?? t("document.title")}
          backLabel={t("common.back")}
          onBack={() => router.back()}
          size="inline"
        />
      }
    >
      <Segmented
        aria-label={t("document.tabs.label")}
        options={TABS.map((value) => ({ value, label: t(`document.tabs.${value}`) }))}
        value={tab}
        onValueChange={(next) => router.replace(routes.document(locale, id, next) as never)}
      />
      {document.isError ? <EmptyState title={t("document.notFound")} /> : null}
      {document.data && tab === "document" ? <Infos document={document.data} /> : null}
      {document.data && tab === "rapport" ? (
        <Verifications document={document.data} followed={analysis ?? document.data.analyses[0]?.id} locale={locale} />
      ) : null}
    </Screen>
  );
}

function Infos({ document }: Readonly<{ document: DocumentDetail }>) {
  const { t } = useI18n();
  const kept = deviceStore.uriOf(document.id) !== null;
  return (
    <View style={{ gap: 12 }}>
      <Badge tone="accent">{t(`document.status.${document.status}`)}</Badge>
      <DescriptionList
        items={[
          { term: t("document.title"), details: document.filename },
          { term: t("document.kindLabel"), details: t(`document.kind.${document.kind}`) },
          ...(document.pages
            ? [{ term: t("document.pagesLabel"), details: t("document.pages", { count: document.pages }) }]
            : []),
          { term: t("verify.onDevice"), details: kept ? t("document.kept") : t("document.notKept") },
        ]}
      />
      <Txt tone="muted" variant="caption">
        {t("disclaimer")}
      </Txt>
    </View>
  );
}

function Verifications({
  document,
  followed,
  locale,
}: Readonly<{ document: DocumentDetail; followed: string | undefined; locale: Locale }>) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const checks = availableChecks(document);
  const start = useMutation({
    mutationFn: (request: (typeof checks)[number]) => verikora.startAnalysis(document.id, request),
    onSuccess: async ({ analysis }) => {
      await queryClient.invalidateQueries({ queryKey: keys.document(document.id) });
      router.replace(`${routes.document(locale, document.id, "rapport")}?analysis=${analysis.id}` as never);
    },
  });
  return (
    <View style={{ gap: 16 }}>
      {followed ? (
        <Followed documentId={document.id} analysisId={followed} locale={locale} hasText={document.hasText} />
      ) : (
        <EmptyState title={t("document.noChecks")} />
      )}
      {!document.hasText && document.mimeType === "application/pdf" ? (
        <Txt tone="secondary">{t("verify.noTextLayer")}</Txt>
      ) : null}
      {checks.length === 0 ? <Txt tone="secondary">{t("verify.nothingToCheck")}</Txt> : null}
      {checks.map((request) => (
        <Button
          key={request.studio}
          variant="secondary"
          label={`${t("check.start")} · ${t(CHECK_LABEL[request.studio])}`}
          loading={start.isPending}
          onPress={() => start.mutate(request)}
        />
      ))}
      {start.isError ? <Txt tone="danger">{t("verify.failed")}</Txt> : null}
      <OtherRuns
        analyses={document.analyses.filter((a) => a.id !== followed)}
        documentId={document.id}
        locale={locale}
      />
    </View>
  );
}

function Followed({
  documentId,
  analysisId,
  locale,
  hasText,
}: Readonly<{ documentId: string; analysisId: string; locale: Locale; hasText: boolean }>) {
  const { t } = useI18n();
  const run = useQuery(queries.analysis(documentId, analysisId, locale));
  const share = useMutation({ mutationFn: () => shareSignedReport(documentId, analysisId, locale) });
  const found = run.data?.analysis;
  const steps = checkSteps({
    hasText,
    analysis: found ? { studio: found.studio, status: found.status } : null,
    studio: found?.studio,
  });
  return (
    <View style={{ gap: 16 }}>
      <CheckProgress steps={steps} runId={found?.runId ?? null} />
      {found && found.status !== ANALYSIS_STATUS.running && found.status !== ANALYSIS_STATUS.succeeded ? (
        <Txt tone="danger">{found?.error ?? t("result.failedHint")}</Txt>
      ) : null}
      {run.data?.closingNote ? (
        <>
          <ClosingNote note={run.data.closingNote} />
          {found?.studio === CHECK.compliance ? (
            <>
              <Button
                variant="primary"
                label={share.isPending ? t("result.sharing") : t("result.share")}
                loading={share.isPending}
                onPress={() => share.mutate()}
              />
              {share.isError ? <Txt tone="danger">{t("result.shareFailed")}</Txt> : null}
              <Txt tone="muted" variant="caption">
                {t("result.signed")}
              </Txt>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function OtherRuns({
  analyses,
  documentId,
  locale,
}: Readonly<{ analyses: readonly Analysis[]; documentId: string; locale: Locale }>) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <>
      {analyses.map((run) => (
        <Card.Root
          key={run.id}
          onPress={() =>
            router.replace(`${routes.document(locale, documentId, "rapport")}?analysis=${run.id}` as never)
          }
        >
          <Card.Body>
            <Txt variant="label">{t(CHECK_LABEL[run.studio])}</Txt>
            <Txt tone="muted" variant="caption">
              {new Date(run.createdAt).toLocaleString(locale)}
            </Txt>
          </Card.Body>
        </Card.Root>
      ))}
    </>
  );
}
