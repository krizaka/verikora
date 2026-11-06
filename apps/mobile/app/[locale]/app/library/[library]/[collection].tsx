import { useQuery } from "@krizaka/query";
import { Chip, EmptyState, Header, Screen, Txt } from "@krizaka/ui/native";
import { List } from "@krizaka/ui/native/list";
import { type DocumentSummary, parseTagsParam, toggleTag } from "@verikora/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { queries } from "@/config";
import { routes } from "@/domain/links";
import { useI18n } from "@/i18n";
import { DocumentRow } from "@/ui/DocumentRow";
import { useLocale } from "@/use-locale";

/** A collection's documents; the tags that filter them are `?tags=a,b`, so back, a refresh and a shared link keep them. */
export default function Collection() {
  const { collection, tags } = useLocalSearchParams<{ collection: string; tags?: string }>();
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  const selected = parseTagsParam(tags);
  const libraries = useQuery(queries.libraries());
  const documents = useQuery(queries.collection(collection, selected));
  const meta = libraries.data?.libraries.flatMap((l) => l.collections).find((c) => c.id === collection);
  const allTags = libraries.data?.tags ?? [];

  const header = allTags.length ? (
    <View style={{ gap: 8, paddingBottom: 12 }}>
      <Txt variant="label">{t("library.tagsLabel")}</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {allTags.map((tag) => (
          <Chip
            key={tag.id}
            selected={selected.includes(tag.id)}
            onSelectedChange={() => router.setParams({ tags: toggleTag(selected, tag.id).join(",") || undefined })}
          >
            {tag.name}
          </Chip>
        ))}
      </View>
    </View>
  ) : undefined;

  return (
    <Screen
      scroll={false}
      header={
        <Header
          title={meta?.name ?? t("library.title")}
          backLabel={t("common.back")}
          onBack={() => router.replace(routes.library(locale) as never)}
          size="inline"
        />
      }
    >
      <List<DocumentSummary>
        label={meta?.name ?? t("library.title")}
        data={documents.data?.documents ?? []}
        keyExtractor={(document) => document.id}
        renderItem={(document) => <DocumentRow document={document} />}
        header={header}
        loading={documents.isPending}
        refreshing={documents.isRefetching}
        onRefresh={() => void documents.refetch()}
        empty={<EmptyState title={t("library.emptyCollection")} />}
        separator="none"
      />
    </Screen>
  );
}
