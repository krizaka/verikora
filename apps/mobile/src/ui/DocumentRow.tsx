import { Badge, Card, Txt } from "@krizaka/ui/native";
import type { DocumentSummary } from "@verikora/core";
import { useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { routes } from "@/domain/links";
import { useI18n } from "@/i18n";
import { useLocale } from "@/use-locale";

/** A document in a list: its title, what it is and where it stands, the whole row one link to its page. */
export function DocumentRow({ document }: Readonly<{ document: DocumentSummary }>) {
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  return (
    <Card.Root onPress={() => router.navigate(routes.document(locale, document.id) as never)}>
      <Card.Body>
        <Txt variant="label" numberOfLines={1}>
          {document.title}
        </Txt>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Badge tone={document.status === "attention" ? "warning" : "neutral"}>
            {t(`document.status.${document.status}`)}
          </Badge>
          <Txt tone="muted" variant="caption">
            {t(`document.kind.${document.kind}`)}
          </Txt>
        </View>
      </Card.Body>
    </Card.Root>
  );
}
