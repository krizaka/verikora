import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { BatchProgress } from "./BatchProgress";

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const item = (line: number, state: string, patch: Record<string, unknown> = {}) => ({
  id: `i${line}`,
  line,
  file: `f${line}.pdf`,
  reference: `R-${line}`,
  state,
  error: null,
  documentId: `d${line}`,
  ...patch,
});
const batch = (patch: Record<string, unknown> = {}) => ({
  id: "b1",
  name: "Immeuble Laurier",
  finishedAt: null,
  pausedBy: null,
  items: [
    item(2, "done"),
    item(3, "running"),
    item(4, "refused", { error: "UNKNOWN_CHECK,FILE_NOT_SENT", documentId: null }),
  ],
  counts: { pending: 0, reused: 0, running: 1, done: 1, failed: 0, refused: 1 },
  ...patch,
});
const render = (b: ReturnType<typeof batch>, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <BatchProgress initial={b as never} />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("a batch's page (verikora#232)", () => {
  it("says how far it is, each row's state, and why a row did not run — in the reader's language", () => {
    const text = readable(render(batch()));
    expect(text).toContain("Immeuble Laurier");
    expect(text).toContain("1 sur 2");
    for (const word of [
      "Vérifié",
      "En cours",
      "Refusé",
      "Vérification inconnue",
      "Ce fichier n'a pas été déposé avec le CSV.",
    ])
      expect(text).toContain(word);
    expect(readable(render(batch(), "en"))).toContain("1 of 2");
  });

  it("links each stored row to its document, and offers the export", () => {
    const html = render(batch());
    expect(html).toContain('href="/fr/app/documents/d2/rapport"');
    expect(html).toContain('href="/api/batches/b1/export"');
  });

  it("says when it is done, and why it waits when the account cannot pay", () => {
    expect(readable(render(batch({ finishedAt: "2026-10-23T05:00:00Z" })))).toContain(
      "Lot terminé : 1 vérifié(s), 0 en échec, 1 refusé(s).",
    );
    expect(render(batch({ pausedBy: "PAYWALL" }))).toContain('href="/fr/app/settings/facturation"');
  });
});
