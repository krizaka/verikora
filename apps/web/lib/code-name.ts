import { CODE_NAME } from "@/lib/brand";
import { appEnvironment } from "@/lib/env";
import { format, getDictionary, type Locale } from "@/lib/i18n";

/**
 * « code name: yomizaka » / « nom de code : yomizaka »: the line under the commercial name on a DEVELOPMENT deployment, so a person can
 * follow the host (dev.yomizaka.com) to the screen (« Verikora »). `null` in production (`APP_ENVIRONMENT=prod`): a commercial domain never
 * shows the code name. The stage is the one `StageNotice` reads; the words are the `stage.codeName` messages (`{code}` is filled here,
 * so the catalogues hold no code name).
 */
export function codeNameLine(locale: Locale, stage: string = appEnvironment()): string | null {
  if (stage === "prod") return null;
  return format(getDictionary(locale).stage.codeName, { code: CODE_NAME });
}
