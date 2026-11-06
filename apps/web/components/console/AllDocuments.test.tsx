import { KrizakaQueryProvider } from "@krizaka/query";
import type { DocumentSummary } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { AllDocuments } from "./AllDocuments";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/documents",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const wrap = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const doc = (n: number): DocumentSummary => ({
  id: `d${n}`,
  title: `Bail ${n}`,
  filename: `bail-${n}.pdf`,
  mimeType: "application/pdf",
  kind: "lease",
  sizeBytes: 1000,
  pages: 1,
  hasText: true,
  status: "checked",
  createdAt: "2026-10-20T12:00:00.000Z",
});

describe("« Documents » (B2, P14)", () => {
  it("lists every document with a link to its page, under one h1", () => {
    const html = wrap(<AllDocuments documents={[doc(1), doc(2)]} />);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(fr.console.documentsPage.title);
    expect(html).toContain('href="/fr/app/documents/d1"');
    expect(html).toContain('href="/fr/app/documents/d2"');
  });
  it("says so with the owl and one action when there is none yet", () => {
    const html = wrap(<AllDocuments documents={[]} />, "en");
    expect(html).toContain('data-testid="documents-empty"');
    expect(html).toContain(en.console.documentsPage.empty);
    expect(html).toContain('href="/en/app/check"');
  });
  it("filters by bookmark: the bar, the bookmarks of each row, and a sentence when none wears them all", () => {
    const urgent = { id: "t1", name: "Urgent", color: "red" as const };
    const html = wrap(
      <AllDocuments
        documents={[doc(1)]}
        bookmarks={[urgent]}
        selected={["t1"]}
        bookmarksByDocument={{ d1: [urgent] }}
        path="/fr/app/documents"
      />,
      "en",
    );
    expect(html).toContain('data-testid="place-filters"');
    expect(html).toContain("Urgent");
    expect(html).toContain(en.console.documentsPage.bookmarks);
    // one tap from the row: the menu's trigger names the document
    expect(html).toContain('data-testid="row-bookmarks"');
    expect(html).toContain("Bookmark Bail 1");
    // and in bulk: the rows are selectable once there are bookmarks
    expect(html).toContain('type="checkbox"');
    const tabs = [
      { id: null, name: null, hue: "accent" as const, count: 1, href: "/fr/app/documents", on: false },
      { id: "t1", name: "Urgent", hue: "danger" as const, count: 1, href: "/fr/app/documents?tags=t1", on: true },
    ];
    const divided = wrap(
      <AllDocuments
        documents={[doc(1)]}
        bookmarks={[urgent]}
        selected={["t1"]}
        bookmarksByDocument={{ d1: [urgent] }}
        path="/fr/app/documents"
        tabs={tabs}
      />,
      "en",
    );
    expect(divided).toContain('data-testid="bookmark-dividers"');
    expect(divided).toContain('href="/fr/app/documents?tags=t1"');
    const none = wrap(
      <AllDocuments documents={[]} bookmarks={[urgent]} selected={["t1"]} path="/en/app/documents" />,
      "en",
    );
    expect(none).toContain('data-testid="documents-nothing"');
    expect(none).not.toContain('data-testid="documents-empty"');
  });
});
