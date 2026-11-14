import { PlusIcon } from "@krizaka/icons/native";
import { useQuery } from "@krizaka/query";
import { Avatar, Header, IconButton } from "@krizaka/ui/native";
import { useRouter } from "expo-router";
import * as React from "react";
import { Pressable, View } from "react-native";

import { BRAND_ID, queries } from "@/config";
import { routes } from "@/domain/links";
import { useI18n } from "@/i18n";
import { useLocale } from "@/use-locale";

/**
 * A tab's header: its title, « Vérifier un document » as its « + » (the one action of every tab, the section map of
 * verikora#319), and the signed-in account on the right at every size (Oussama's decision, 2026-10-23) — the avatar opens
 * the account and the settings.
 */
export function TabHeader({ title }: Readonly<{ title: string }>) {
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  const me = useQuery(queries.me());
  const name = me.data?.name ?? me.data?.email ?? "";
  return (
    <Header
      title={title}
      size="inline"
      actions={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <IconButton
            label={t("header.verify")}
            icon={<PlusIcon />}
            variant="secondary"
            size="sm"
            onPress={() => router.navigate(routes.verify(locale) as never)}
          />
          <Pressable
            role="button"
            aria-label={name ? t("account.openNamed", { name }) : t("account.open")}
            hitSlop={8}
            onPress={() => router.navigate(routes.settings(locale) as never)}
          >
            <Avatar
              size="sm"
              defaultAvatar={{ brand: BRAND_ID, seed: me.data?.avatarSeed ?? me.data?.email ?? "verikora" }}
              fallback={name.charAt(0).toUpperCase() || "Y"}
            />
          </Pressable>
        </View>
      }
    />
  );
}
