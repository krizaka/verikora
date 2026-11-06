import { useQuery } from "@krizaka/query";
import { Card, EmptyState, Screen, Txt } from "@krizaka/ui/native";
import { List } from "@krizaka/ui/native/list";
import type { DocumentSummary } from "@verikora/core";
import { useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { queries } from "@/config";
import { routes } from "@/domain/links";
import { useI18n } from "@/i18n";
import { AppHeader } from "@/ui/AppHeader";
import { DocumentRow } from "@/ui/DocumentRow";
import { useLocale } from "@/use-locale";

/** The library: the collections of each library, then the recent documents. */
export default function Library() {
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  const libraries = useQuery(queries.libraries());
  const documents = useQuery(queries.documents());
  const collections = (libraries.data?.libraries ?? []).flatMap((library) =>
    library.collections.map((collection) => ({ ...collection, libraryId: library.id })),
  );

  const header = (
    <View style={{ gap: 12, paddingBottom: 12 }}>
      {collections.map((collection) => (
        <Card.Root
          key={collection.id}
          onPress={() => router.navigate(routes.library(locale, collection.libraryId, collection.id) as never)}
        >
          <Card.Body>
            <Txt variant="label">{collection.name}</Txt>
            <Txt tone="muted" variant="caption">
              {t("library.files", { count: collection.files })}
            </Txt>
          </Card.Body>
        </Card.Root>
      ))}
      <Txt variant="label">{t("library.recent")}</Txt>
    </View>
  );

  return (
    <Screen header={<AppHeader title={t("library.title")} />} scroll={false}>
      <List<DocumentSummary>
        label={t("library.recent")}
        data={documents.data ?? []}
        keyExtractor={(document) => document.id}
        renderItem={(document) => <DocumentRow document={document} />}
        header={header}
        loading={documents.isPending}
        refreshing={documents.isRefetching}
        onRefresh={() => void documents.refetch()}
        empty={<EmptyState title={t("library.empty")} />}
        separator="none"
      />
    </Screen>
  );
}
