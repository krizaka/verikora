import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { ReportShareAction } from "./ReportShareAction";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/documents/d1/rapport",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const render = (locale: "en" | "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <ReportShareAction documentId="d1" analysisId="a1" />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("ReportShareAction — the share button in the report header (verikora#2293)", () => {
  it("renders the share action button in French", () => {
    const html = render("fr");
    expect(html).toContain('data-testid="report-share-action"');
    expect(html).toContain(fr.console.reportShare.action);
  });

  it("renders the share action button in English", () => {
    const html = render("en");
    expect(html).toContain('data-testid="report-share-action"');
    expect(html).toContain(en.console.reportShare.action);
  });

  it("shows « Pas encore partagé » when no data is loaded yet", () => {
    const html = render("fr");
    expect(html).toContain('data-testid="report-share-status"');
    expect(html).toContain(fr.console.reportShare.notShared);
  });

  it("has the same keys in both languages", () => {
    expect(Object.keys(en.console.reportShare).sort()).toEqual(Object.keys(fr.console.reportShare).sort());
  });
});
