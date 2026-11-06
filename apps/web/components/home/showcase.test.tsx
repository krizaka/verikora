import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/en",
}));

import Home from "@/app/[locale]/page";
import { demoOwnerDocument } from "@/lib/landing-demo";
import { recordedRun } from "@/lib/recorded-runs";

/** yomizaka#478: the home's feature cards hold the app's own screens, inert, hidden from assistive technology, with a text alternative. */
describe("the home's feature cards", () => {
  it("draws two screens, each inert and aria-hidden, each card with its text alternative", async () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>{await Home({ params: Promise.resolve({ locale: "en" }) })}</ThemeProvider>,
    );
    for (const id of ["screen-findings", "screen-owner"]) {
      expect(html).toMatch(
        new RegExp(
          `aria-hidden="true"[^>]*inert[^>]*data-testid="${id}"|inert[^>]*aria-hidden="true"[^>]*data-testid="${id}"`,
        ),
      );
    }
    expect(html.match(/class="sr-only"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("feature-screening");
  });

  it("uses data the app's own schemas accept, from the recorded run", () => {
    const doc = demoOwnerDocument(recordedRun("tenant"));
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.findings.length).toBeGreaterThan(0);
    expect(doc.runs[0]!.runId).toBe(recordedRun("tenant").runId);
  });
});
