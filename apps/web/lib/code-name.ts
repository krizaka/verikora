import { CODE_NAME } from "@/lib/brand";
import { format, getDictionary, type Locale } from "@/lib/i18n";

/**
 * « code name: yomizaka » / « nom de code : yomizaka »: the line under the commercial name, so a developer can
 * follow a host to the screen (« Verikora »). Shown only behind the dev-only flag `APP_SHOW_CODE_NAME` (meeting of 2026-11-05: never on
 * the public face, www.yomizaka.com included); `null` otherwise. The words are the `stage.codeName` messages (`{code}` is filled here,
 * so the catalogues hold no code name). The flag arrives as a parameter (`showCodeName()`, read by the layout at the edge).
 */
export function codeNameLine(locale: Locale, show: boolean): string | null {
  if (!show) {
    return null;
  }
  return format(getDictionary(locale).stage.codeName, { code: CODE_NAME });
}
