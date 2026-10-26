import { EnvironmentNotice } from "@krizaka/ui/environment-notice";

import { getDictionary, type Locale } from "@/lib/i18n";

/**
 * « Development version, data can be reset, not a commercial offer »: on every page of a deployment that is not production
 * (web and the administration console share the locale layout). The stage is the deployment's `APP_ENVIRONMENT`, read once by
 * the layout; `prod` renders nothing (the block's rule, `environmentNotice`). Words from the messages (yomizaka#364).
 */
export function EnvironmentBand({ locale, stage }: { locale: Locale; stage: string }) {
  const t = getDictionary(locale).environment;
  return <EnvironmentNotice stage={stage} title={t.title} message={t.message} />;
}
