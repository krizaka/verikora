// Journey « visitor-to-sign-in » (journeys.json; krizaka-internal#3431): a visitor reads the prices, chooses « Se connecter » and signs in
// as Eric. Every wait is on the page's state (a URL, a visible element), never on time.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, CAST } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "visitor-to-sign-in",
);

test("a visitor reads the prices, signs in and reaches the app", async ({ browser }, info) => {
  const who = CAST.eric;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...videoContextOptions(JOURNEY, { dir: info.outputDir }),
  });
  const page = await context.newPage();

  await page.goto(new URL("/fr", BASE).toString());
  await page.getByRole("link", { name: "Tarifs" }).first().click();
  await expect(page, "the bar leads to the prices").toHaveURL(/\/fr\/pricing/);
  await expect(page.getByRole("heading", { level: 1, name: "Tarifs" }), "the prices page is on screen").toBeVisible();

  // The bar's session island decides after hydration: a visitor sees « Se connecter ».
  await page.getByRole("link", { name: "Se connecter" }).first().click();
  await expect(page, "the sign-in page opens").toHaveURL(/\/fr\/sign-in/);
  await page.locator("input[type=email]").first().fill(who.email);
  await page.locator("input[type=password]").first().fill(who.password);
  await page.locator("form button[type=submit]").first().click();
  await expect(page, "signed in, the visitor reaches the app").toHaveURL(/\/app(\/|\?|$)/, { timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Se connecter" }), "no « Sign in » once signed in").toHaveCount(0);
  await context.close();
});
