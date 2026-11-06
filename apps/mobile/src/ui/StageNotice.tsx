import { EnvironmentNotice } from "@krizaka/ui/native";
import * as React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { stage } from "@/config";
import { isShowcase, noticeStage } from "@/domain/showcase";
import { useI18n } from "@/i18n";

/** « Development version, data can be reset, not a commercial offer » above every screen (verikora#364); `prod` renders nothing, and so does the filmed showcase build (verikora#1968). */
export function StageNotice({
  stageOf = noticeStage(stage, isShowcase(process.env.EXPO_PUBLIC_APP_SHOWCASE)),
}: Readonly<{ stageOf?: string }>) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <EnvironmentNotice
      stage={stageOf}
      title={t("stage.title")}
      message={t("stage.message")}
      style={{ paddingTop: insets.top }}
    />
  );
}
