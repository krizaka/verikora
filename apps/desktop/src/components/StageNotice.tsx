import { EnvironmentNotice } from "@krizaka/ui/environment-notice";

import { useI18n } from "../i18n";

/** « Development version, data can be reset, not a commercial offer » above the window (verikora#364); the stage `prod` renders nothing. */
export function StageNotice({ stage, showcase = false }: Readonly<{ stage: string; showcase?: boolean }>) {
  const { t } = useI18n();
  // The filmed build (the download-videos workflow only, verikora#1968) draws no notice: the stage is unchanged.
  return <EnvironmentNotice stage={showcase ? "prod" : stage} title={t("stage.title")} message={t("stage.message")} />;
}
