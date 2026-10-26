import { EnvironmentNotice } from "@krizaka/ui/environment-notice";

import { useI18n } from "../i18n";

/** « Development version, data can be reset, not a commercial offer » above the window (yomizaka#364); the stage `prod` renders nothing. */
export function StageNotice({ stage }: Readonly<{ stage: string }>) {
  const { t } = useI18n();
  return <EnvironmentNotice stage={stage} title={t("stage.title")} message={t("stage.message")} />;
}
