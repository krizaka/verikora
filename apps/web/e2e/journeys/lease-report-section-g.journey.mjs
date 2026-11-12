// Journey « lease-report-section-g » (journeys.json): a tenant opens the report of a lease with no TAL notice and sees
// Section G, one quoted passage and one article. The result the customer reads is asserted, not « the page loaded ».
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, sessionsFor } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "lease-report-section-g",
);

test("a tenant opens the report of a lease with no TAL notice and sees Section G", async ({ browser }, info) => {
  const state = await sessionsFor(browser, info.workerIndex).stateFor("eric");
  const context = await browser.newContext({
    storageState: state,
    ...videoContextOptions(JOURNEY, { dir: info.outputDir }),
  });
  const page = await context.newPage();

  await page.goto(new URL("/fr/app/documents", BASE).toString());
  const link = page.locator('a[href*="/app/documents/"]', { hasText: "avis du TAL absent" }).first();
  await expect(link, "the seeded lease without a TAL notice is in the library").toBeVisible();
  const href = await link.getAttribute("href");
  const id = href?.match(/\/app\/documents\/([^/?#]+)/)?.[1];
  expect(id, "the library links the lease by its id").toBeTruthy();

  await page.goto(new URL(`/fr/app/documents/${id}/rapport`, BASE).toString());
  // The report is AnalysisReport's (krizaka-internal#2293): each finding quotes the passage it rests on and cites its article.
  const report = page.getByTestId("compliance-report");
  await expect(report, "the compliance report is on the page").toBeVisible();
  const finding = report.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /avis du TAL/i }) });
  await expect(finding, "the Section G finding is in the report").toBeVisible();
  await expect(finding, "the finding cites its source").toContainText(/art\.|TAL|C\.c\.Q\./);

  // The recorded Sovkora run the home shows (content/recorded-runs): a finding quotes the passage of the lease and cites its article, as the run returned them.
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const home = await visitor.newPage();
  await home.goto(new URL("/fr", BASE).toString());
  // The proof is drawn inert (the app's own component, aria-hidden): found by its test id, not by role.
  const recorded = home.locator('[data-testid="compliance-report"]').first();
  await recorded.scrollIntoViewIfNeeded({ timeout: 30_000 });
  const quoted = recorded.locator("li", { has: home.locator("p", { hasText: /^«.+»$/ }) });
  await expect(quoted.first(), "a finding of the recorded run quotes the passage it rests on").toBeVisible();
  await expect(
    quoted.first().locator("p.font-semibold"),
    "the same finding names its article or its source",
  ).toBeVisible();
  await visitor.close();
  await context.close();
});
