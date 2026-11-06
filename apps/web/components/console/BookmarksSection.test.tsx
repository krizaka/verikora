import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_SECTIONS } from "@/lib/console-nav";
import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { BookmarksSection } from "./BookmarksSection";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const wrap = (node: React.ReactNode, locale: "en" | "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const groups = [
  { kind: "applicant_file" as const, bookmarks: [{ id: "t1", name: "Garant", color: "amber" as const }] },
  { kind: "document" as const, bookmarks: [] },
];

describe("« Signets » (verikora#339)", () => {
  it("lists each kind's bookmarks with their marker, and says when a kind has none, in both languages", () => {
    const fr1 = wrap(<BookmarksSection groups={groups} />, "fr");
    expect(fr1).toContain("Garant");
    expect(fr1).toContain("Dossiers de candidature");
    expect(fr1).toContain("Aucun signet");
    expect(fr1).toContain("Renommer ou recolorer « Garant »");
    const en1 = wrap(<BookmarksSection groups={groups} />, "en");
    expect(en1).toContain("No bookmark yet.");
    expect(en1).toContain("Delete “Garant”");
    expect(en1).toContain("New tag");
  });

  it("is a settings section with a tab in both languages", () => {
    expect(SETTINGS_SECTIONS).toContain("signets");
    expect(en.console.settings.tabs.signets).toBeTruthy();
    expect(fr.console.settings.tabs.signets).toBeTruthy();
  });
});
