import type { Locale } from "./i18n";

const LANGS: readonly Locale[] = ["en", "fr"];

/**
 * The language of the owner's page (verikora#246): the one asked for (`?lang=`), else the browser's first supported language
 * (`Accept-Language`, by weight), else the page's own locale. Pure; nothing is translated here, only chosen.
 */
export function pickReportLang(asked: string | undefined, acceptLanguage: string | null, fallback: Locale): Locale {
  const direct = LANGS.find((l) => l === asked);
  if (direct) return direct;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(
        params
          .find((p) => p.trim().startsWith("q="))
          ?.trim()
          .slice(2) ?? 1,
      );
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return LANGS.find((l) => l === ranked.find((r) => LANGS.some((x) => x === r.lang))?.lang) ?? fallback;
}
