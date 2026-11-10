// @vitest-environment jsdom
import { KrizakaQueryProvider } from "@krizaka/query";
import { offerOf } from "@verikora/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { catalogueOf } from "@/lib/check-catalogue";
import { SEED_FLOWS } from "@/lib/flows-seed";
import { I18nProvider } from "@/lib/i18n-client";
import fr from "@/messages/fr.json";

import { CheckView } from "./CheckView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/check",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tenantOffer = offerOf(
  SEED_FLOWS.filter((f) => f.definition.audiences.includes("tenant")).map((f) => f.definition),
);
const tenant = catalogueOf(tenantOffer);
const tenantQC = catalogueOf(tenantOffer, "QC");
let root: Root | null = null;
let host: HTMLElement;
const mountWith = async (catalogue: typeof tenant, search = "") => {
  window.history.replaceState(null, "", `/fr/app/check${search}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="fr" messages={{ console: fr.console } as never}>
        <KrizakaQueryProvider>
          <CheckView catalogue={catalogue} credits={{ kind: "credits", left: 3 }} />
        </KrizakaQueryProvider>
      </I18nProvider>,
    );
  });
};
const mount = (search = "") => mountWith(tenant, search);
const rows = () => [...host.querySelectorAll('[data-testid="check-catalogue"] li')].map((li) => li.textContent ?? "");
const chip = (text: string) =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="catalogue-chips"] [role="radio"]')].find((c) =>
    c.textContent?.startsWith(text),
  )!;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
});

describe("QC territory: the QC lease leads, authenticity next (krizaka-internal#2292)", () => {
  it("the first row in the rendered list contains 'Québec' when the catalogue is QC-ordered", async () => {
    await mountWith(tenantQC);
    expect(rows()[0]).toContain("Québec");
  });
  it("the second row contains 'Authenticit' (before FR and BE leases)", async () => {
    await mountWith(tenantQC);
    expect(rows()[1]).toContain("Authenticit");
  });
});

describe("the catalogue's state is the address (verikora#333)", () => {
  it("a group chosen in the address narrows the rows, and the chip says so", async () => {
    await mount("?groupe=notice");
    expect(rows()).toHaveLength(2);
    expect(chip("Avis et états").getAttribute("aria-checked")).toBe("true");
  });

  it("choosing a chip puts the group in the address and narrows the rows; « Toutes » clears it", async () => {
    await mount();
    expect(rows()).toHaveLength(6);
    await act(async () => chip("Baux").click());
    expect(window.location.search).toBe("?groupe=lease");
    expect(rows()).toHaveLength(3);
    await act(async () => chip("Toutes").click());
    expect(window.location.search).toBe("");
    expect(rows()).toHaveLength(6);
  });

  it("the search narrows the rows and the counts of the chips, without leaving the page", async () => {
    await mount();
    const input = host.querySelector<HTMLInputElement>('[data-testid="check-catalogue"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "wallonie");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows()).toHaveLength(1);
    expect(chip("Toutes").textContent).toContain("1");
    expect(chip("Avis et états").textContent).toContain("0");
    expect(window.location.search).toBe("");
  });

  it("the kind named in the address is said above the drop, with a way to change it", async () => {
    await mount("?type=lease");
    const chosen = host.querySelector('[data-testid="check-chosen"]');
    expect(chosen?.textContent).toContain("Vérification choisie : Bail");
    expect(chosen?.querySelector("a")?.getAttribute("href")).toBe("/fr/app/check");
  });

  it("no chosen line without a kind", async () => {
    await mount();
    expect(host.querySelector('[data-testid="check-chosen"]')).toBeNull();
  });
});
