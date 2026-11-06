import { useQuery } from "@krizaka/query";
import { Card, EmptyState, Screen, Segmented, Txt } from "@krizaka/ui/native";
import { List } from "@krizaka/ui/native/list";
import { CHECKS_TABS, type DocumentSummary } from "@verikora/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { queries } from "@/config";
import { routes } from "@/domain/links";
import { checksTabOf } from "@/domain/tabs";
import { useI18n } from "@/i18n";
import { AppHeader } from "@/ui/AppHeader";
import { DocumentRow } from "@/ui/DocumentRow";
import { useLocale } from "@/use-locale";

type Batch = { id: string; name: string; items: number; done: number };

/**
 * Vérifications, a destination of the section map (verikora#319): the documents checked, then the batches as its second
 * tab (« Lots »), the tab in the address as on the web. A batch is imported from the web or the Mac; the phone reads it.
 */
export default function Checks() {
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  const tab = checksTabOf(useLocalSearchParams<{ tab?: string }>().tab);
  const documents = useQuery(queries.documents());
  const batches = useQuery({ ...queries.batches(), enabled: tab === "lots" });
  const checked = (documents.data ?? []).filter((document) => document.status !== "stored");

  const header = (
    <View style={{ paddingBottom: 12 }}>
      <Segmented
        aria-label={t("checksTabs.label")}
        options={CHECKS_TABS.map((value) => ({ value, label: t(`checksTabs.${value}`) }))}
        value={tab}
        onValueChange={(next) => router.replace(routes.checks(locale, next) as never)}
      />
    </View>
  );

  return (
    <Screen header={<AppHeader title={t("sections.checks")} />} scroll={false}>
      {tab === "lots" ? (
        <List<Batch>
          label={t("checksTabs.lots")}
          data={batches.data ?? []}
          keyExtractor={(batch) => batch.id}
          renderItem={(batch) => (
            <Card.Root>
              <Card.Body>
                <Txt variant="label" numberOfLines={1}>
                  {batch.name}
                </Txt>
                <Txt tone="muted" variant="caption">
                  {t("checks.batchProgress", { done: batch.done, items: batch.items })}
                </Txt>
              </Card.Body>
            </Card.Root>
          )}
          header={header}
          loading={batches.isPending}
          refreshing={batches.isRefetching}
          onRefresh={() => void batches.refetch()}
          empty={<EmptyState title={t("checks.lotsEmpty")} />}
          separator="none"
        />
      ) : (
        <List<DocumentSummary>
          label={t("checksTabs.checks")}
          data={checked}
          keyExtractor={(document) => document.id}
          renderItem={(document) => <DocumentRow document={document} />}
          header={header}
          loading={documents.isPending}
          refreshing={documents.isRefetching}
          onRefresh={() => void documents.refetch()}
          empty={<EmptyState title={t("checks.empty")} />}
          separator="none"
        />
      )}
    </Screen>
  );
}
