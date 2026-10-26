import { EnvironmentNotice } from "@krizaka/ui/native";
import * as React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { stage } from "@/config";
import { useI18n } from "@/i18n";

/** « Development version, data can be reset, not a commercial offer » above every screen (yomizaka#364); `prod` renders nothing. */
export function StageNotice({ stageOf = stage }: Readonly<{ stageOf?: string }>) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return <EnvironmentNotice stage={stageOf} title={t("stage.title")} message={t("stage.message")} style={{ paddingTop: insets.top }} />;
}
