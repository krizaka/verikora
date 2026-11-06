import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import { SHARE_MAX_DAYS } from "@/lib/owner-report";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { OwnerShare, SHARE_CHOICES } from "./OwnerShare";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/dossiers/x",
  useSearchParams: () => new URLSearchParams(""),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const render = (locale: "en" | "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <OwnerShare fileId="f1" origin="https://dev.verikora.com" />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("the owner link block of a file (verikora#128)", () => {
  it("offers 7 days first and 30 at most, with the create action, in French", () => {
    const html = render("fr");
    expect(SHARE_CHOICES[0]).toBe(7);
    expect(Math.max(...SHARE_CHOICES)).toBe(SHARE_MAX_DAYS);
    expect(html).toContain('data-testid="owner-share"');
    expect(html).toContain(fr.console.dossiers.share.create);
    expect(html).toContain("7 jours");
    expect(html).toContain("30 jours");
  });

  it("is written in both languages with the same keys", () => {
    expect(Object.keys(en.console.dossiers.share).sort()).toEqual(Object.keys(fr.console.dossiers.share).sort());
    expect(render("en")).toContain(en.console.dossiers.share.title);
  });
});
