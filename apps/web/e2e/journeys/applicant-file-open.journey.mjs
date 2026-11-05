// Journey « applicant-file-open » (journeys.json; krizaka-internal#2289): a property manager, Eric, opens « Dossiers » from the rail,
// opens the file of an applicant and reaches the report of the applicant's pay stub. Run on a desktop and on a phone. It never
// opened an applicant file on a deployed persona before: Éric's saved side was « tenant » on the shared dev database, so the
// section was missing from the rail and its page answered 404.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { beat, openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "applicant-file-open",
);

for (const screen of SCREENS) {
  test(`Eric opens « Dossiers », then an applicant's file, then the report of a document (${screen.name})`, async ({
    browser,
  }, info) => {
    const page = await openAs({
      browser,
      info,
      persona: "eric",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app",
    });

    await beat(page, 1500);
    // The rail holds « Dossiers » for a person offered the applicant files; on a phone it sits behind the menu button.
    const entry = page
      .locator("a[data-rail-item]")
      .filter({ hasText: /^Dossiers/ })
      .first();
    const menu = page.getByRole("button", { name: "Ouvrir le menu" });
    await expect(entry.or(menu), "the rail or its menu is there").toBeVisible();
    if (!(await entry.isVisible())) {
      await menu.click();
    }
    await expect(entry, "« Dossiers » is in the rail of a property manager").toBeVisible();
    await entry.click();

    await expect(page, "the applicant files open, not a 404").toHaveURL(/\/fr\/app\/dossiers$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dossiers de candidats");
    await expect(page.getByTestId("files-not-offered"), "Eric is offered the applicant files").toHaveCount(0);

    await beat(page, 1800);
    await page
      .getByRole("link", { name: /Camille Fictif/ })
      .first()
      .click();
    await expect(page, "the file opens").toHaveURL(/\/fr\/app\/dossiers\/[^/?#]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Camille Fictif");

    await beat(page, 2000);
    const asked = page.getByTestId("file-asked");
    await asked.getByRole("link").first().click();
    await expect(page, "the report of the applicant's document opens").toHaveURL(
      /\/fr\/app\/documents\/[^/]+\/rapport/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await beat(page, 3500);
    await page.context().close();
  });
}
