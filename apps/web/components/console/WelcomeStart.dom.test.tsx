// @vitest-environment jsdom
import { KrizakaQueryProvider } from "@krizaka/query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { WelcomeStart } from "./WelcomeStart";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace, refresh() {} }),
  usePathname: () => "/fr/app/welcome",
  useSearchParams: () => new URLSearchParams(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const AUDIENCES = (["landlord", "tenant", "freelancer", "business"] as const).map((audience) => ({
  audience,
  status: audience === "landlord" || audience === "tenant" ? ("available" as const) : ("soon" as const),
}));
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
          <WelcomeStart audiences={AUDIENCES} next={`/${locale}/app`} />
        </KrizakaQueryProvider>
      </I18nProvider>,
    );
  });
};
const click = async (el: Element | null) => {
  await act(async () => (el as HTMLElement).click());
};
const sent: unknown[] = [];
const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
  sent.push(JSON.parse(init?.body ?? "{}"));
  return new Response(JSON.stringify({ perspective: "x" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  sent.length = 0;
  replace.mockClear();
});

describe("the first run starts a property manager in one click (krizaka-internal#2291)", () => {
  it("shows one card, the three next steps and one primary, in both languages", async () => {
    await mount("fr");
    expect(host.querySelector("h1")?.textContent).toBe(fr.console.welcome.title);
    expect(host.querySelectorAll("[role=radio]")).toHaveLength(1);
    expect(host.querySelector("[role=radio]")?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelectorAll("ol li")).toHaveLength(3);
    expect(host.textContent).toContain(fr.console.welcome.steps.lease);
    expect(host.querySelector("[data-testid=welcome-start]")?.textContent).toBe(fr.console.welcome.start);
    expect(host.textContent).not.toContain(fr.console.profile.tenant);
  });

  it("puts the focus on the title", async () => {
    await mount("en");
    expect(document.activeElement).toBe(host.querySelector("h1"));
    expect(host.querySelector("h1")?.textContent).toBe(en.console.welcome.title);
  });

  it("« Autre usage » unfolds the other sides, announced by aria-expanded, and the primary saves the one chosen", async () => {
    vi.stubGlobal("fetch", fetchMock);
    await mount("fr");
    const other = host.querySelector("[data-testid=welcome-other]");
    expect(other?.getAttribute("aria-expanded")).toBe("false");
    await click(other);
    expect(other?.getAttribute("aria-expanded")).toBe("true");
    const radios = [...host.querySelectorAll("[role=radio]")];
    expect(radios).toHaveLength(4);
    const label = [...host.querySelectorAll("span")].find((e) => e.textContent === fr.console.profile.tenant);
    await click(label?.closest("label") ?? label ?? null);
    await click(host.querySelector("[data-testid=welcome-start]"));
    expect(sent).toEqual([{ perspective: "tenant" }]);
    expect(replace).toHaveBeenCalledWith("/fr/app");
    vi.unstubAllGlobals();
  });

  it("saves the owner side with one click on « Commencer »", async () => {
    vi.stubGlobal("fetch", fetchMock);
    await mount("fr");
    await click(host.querySelector("[data-testid=welcome-start]"));
    expect(sent).toEqual([{ perspective: "landlord" }]);
    expect(replace).toHaveBeenCalledWith("/fr/app");
    vi.unstubAllGlobals();
  });
});
