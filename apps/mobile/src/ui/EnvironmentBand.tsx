import { EnvironmentNotice } from "@krizaka/ui/native";

import { useI18n } from "@/i18n";

/** « Development version, data can be reset, not a commercial offer »: on every screen of a build whose stage is not `prod` (yomizaka#364). */
export function EnvironmentBand({ stage }: { stage: string }) {
  const { t } = useI18n();
  return <EnvironmentNotice stage={stage} title={t("environment.title")} message={t("environment.message")} />;
}
