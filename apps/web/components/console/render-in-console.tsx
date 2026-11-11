import { KrizakaQueryProvider } from "@krizaka/query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/console/en.json";
import fr from "@/messages/console/fr.json";

/** The console's domain catalogues (`messages/console/`), by locale: the words the console's I18nProvider receives. */
export const CONSOLE_MESSAGES = { en, fr } as const;

/**
 * A console component rendered to HTML inside the providers the console gives it (the console's words, the query client).
 * For tests of console components: one place for the setup they all need (a test still mocks `next/navigation` itself,
 * since vitest hoists `vi.mock` in the file that calls it).
 */
export function renderInConsole(locale: "en" | "fr", node: ReactNode): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={CONSOLE_MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
}
