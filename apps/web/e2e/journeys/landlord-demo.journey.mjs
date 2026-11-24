// Journey « landlord-demo » (journeys.json; verikora#4785): the dry run of the demo a landlord is given. The landlord demo persona
// signs in, sees one sample lease and nothing of any candidate, reads the landlord-side report that cites the Civil Code, and takes
// the signed PDF — the fallback shown if the app is down — whose seal verifies. Each step is captured (the test's output folder).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, markSeededCheck, openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "landlord-demo",
);
const LEASE = "logement témoin (clause illégale)";
const CANDIDATE_WORDS = /candidat|villeray|relevé de paie|relevé bancaire|lettre d'emploi/i;

// The seeded check is a demo one, never sealed: it is a recorded run for this journey, and a demo check again after it.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => markSeededCheck(LEASE, false));
test.afterAll(() => markSeededCheck(LEASE, true));

for (const screen of SCREENS) {
  test(`the landlord demo reads a sample lease from the landlord's side and takes the signed PDF (${screen.name})`, async ({
    browser,
  }, info) => {
    const shot = (page, step) => page.screenshot({ path: join(info.outputDir, `${screen.name}-${step}.png`) });
    const page = await openAs({
      browser,
      info,
      persona: "demo-landlord",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app/documents",
    });

    // 1. The library: the sample lease, and nothing of any candidate.
    const link = page.locator('a[href*="/app/documents/"]', { hasText: LEASE }).first();
    await expect(link, "the sample lease is in the library").toBeVisible();
    await expect(page.locator('a[href*="/app/documents/"]'), "the library holds the one sample lease").toHaveCount(1);
    expect(await page.locator("body").innerText(), "no candidate collection or document is visible").not.toMatch(
      CANDIDATE_WORDS,
    );
    await shot(page, "1-library");

    // 2. The report, read from the landlord's side, with the Civil Code cited.
    const id = (await link.getAttribute("href"))?.match(/\/app\/documents\/([^/?#]+)/)?.[1];
    expect(id, "the library links the lease by its id").toBeTruthy();
    await page.goto(new URL(`/fr/app/documents/${id}/rapport`, BASE).toString());
    const report = page.getByTestId("compliance-report");
    await expect(report, "the compliance report is on the page").toBeVisible();
    await expect(report, "the report cites the Civil Code article").toContainText(/Code civil du Québec/);
    await expect(report, "the report is written for the landlord").toContainText(/Pour le locateur/);
    await shot(page, "2-report");

    // 3. The signed PDF (the fallback if the app is down): kept, and its seal verifies.
    await page.getByTestId("document-menu").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Télécharger le PDF" }).click(),
    ]);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1"), "the download is a PDF").toBe("%PDF-");
    const fallback = join(info.outputDir, `demo-fallback-report-${screen.name}.pdf`);
    writeFileSync(fallback, bytes);
    await info.attach("demo-fallback-report.pdf", { path: fallback, contentType: "application/pdf" });

    await page.goto(new URL("/fr/app/verifications/report", BASE).toString());
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: download.suggestedFilename(), mimeType: "application/pdf", buffer: bytes });
    await page.locator("form button[type=submit]").first().click();
    await expect(page.getByTestId("verify-ok"), "the seal of the fallback report verifies").toBeVisible();
    await shot(page, "3-seal");
    await page.context().close();
  });
}
