import { EnvironmentNotice } from "@krizaka/ui/environment-notice";

import { useI18n } from "../i18n";

/** « Development version, data can be reset, not a commercial offer »: above the window of a build whose stage is not `prod` (yomizaka#364). */
export function EnvironmentBand({ stage }: { stage: string }) {
  const { t } = useI18n();
  return <EnvironmentNotice stage={stage} title={t("environment.title")} message={t("environment.message")} />;
}
