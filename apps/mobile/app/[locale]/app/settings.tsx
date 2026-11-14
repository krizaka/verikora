import { Button, Card, Screen, Segmented, Txt } from "@krizaka/ui/native";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { useAuth } from "@/auth";
import { APP_VERSION, webUrl } from "@/config";
import { LOCALES } from "@/domain/links";
import { useI18n } from "@/i18n";
import { TabHeader } from "@/ui/TabHeader";
import { useLocale } from "@/use-locale";

/** The settings: the language (the URL's), where the documents live, the account. */
export default function Settings() {
  const { t } = useI18n();
  const { locale, setLocale } = useLocale();
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <Screen header={<TabHeader title={t("settings.title")} />}>
      <View style={{ gap: 8 }}>
        <Txt variant="label">{t("settings.language")}</Txt>
        <Segmented
          aria-label={t("settings.language")}
          options={LOCALES.map((value) => ({ value, label: t(`settings.languages.${value}`) }))}
          value={locale}
          onValueChange={setLocale}
        />
      </View>
      <Card.Root>
        <Card.Body>
          <Txt variant="label">{t("settings.storage")}</Txt>
          <Txt tone="secondary">{t("settings.storageBody")}</Txt>
        </Card.Body>
      </Card.Root>
      <Button
        variant="ghost"
        label={t("settings.privacy")}
        onPress={() => void Linking.openURL(webUrl(`/${locale}/privacy`))}
      />
      <Button
        variant="secondary"
        label={t("settings.signOut")}
        onPress={() => void signOut().then(() => router.replace("/sign-in"))}
      />
      <Txt tone="muted" variant="caption">
        {t("settings.version", { version: APP_VERSION })}
      </Txt>
    </Screen>
  );
}
