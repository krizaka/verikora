// @vitest-environment jsdom
import { KrizakaQueryProvider } from "@krizaka/query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { SignUpForm } from "./SignUpForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/sign-up",
  useSearchParams: () => new URLSearchParams(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The form's controls observe their size; jsdom has no ResizeObserver.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let root: Root | null = null;
let host: HTMLElement;
const mount = async (locale: "fr" | "en") => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale} messages={{ console: (locale === "fr" ? fr : en).console } as never}>
        <KrizakaQueryProvider>
          <SignUpForm />
        </KrizakaQueryProvider>
      </I18nProvider>,
    );
  });
};
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

// verikora#366 (Loi 96, art. 55): the terms of a contract of adhesion are given in French first; English is a choice made after.
describe("sign-up shows the French terms first (verikora#366)", () => {
  it("in French (the default), the consents link the French terms and privacy notice", async () => {
    await mount("fr");
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/fr/terms");
    expect(hrefs).toContain("/fr/privacy");
    expect(hrefs).not.toContain("/en/terms");
    expect(host.textContent).toContain(fr.console.signUp.termsLink);
  });
  it("in English, chosen afterwards, the same consents link the English pages", async () => {
    await mount("en");
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/en/terms");
    expect(hrefs).toContain("/en/privacy");
  });
});

describe("the pilot code field (krizaka-internal#3230)", () => {
  it.each(["fr", "en"] as const)("is an optional, labelled field in %s", async (locale) => {
    await mount(locale);
    const label = (locale === "fr" ? fr : en).console.signUp.pilotCode;
    const input = [...host.querySelectorAll("input")].find((i) => i.labels?.[0]?.textContent?.includes(label));
    expect(input).toBeTruthy();
    expect(input?.required).toBe(false);
  });
});
