// Journey « home-check-and-dossiers » (journeys.json; krizaka-internal#1898): Eric signs in and, on one screen, sees « Vérifier un
// document » (the drop zone) and his dossiers, then opens one. Run on a desktop and on a phone: the first screen is the promise.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "home-check-and-dossiers",
);

for (const screen of SCREENS) {
  test(`Eric sees his applicant files first on one screen, then opens one (${screen.name})`, async ({
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

    await expect(page.getByRole("heading", { level: 1 }), "the home is titled Accueil").toHaveText("Accueil");
    await expect(page.getByTestId("library-dropzone"), "the home has no second drop zone").toHaveCount(0);
    await expect(page.getByTestId("home-check-button"), "the header's action is the only primary").toHaveCount(0);
    const list = page.getByRole("list", { name: "Vos dossiers de candidats" });
    const first = list.getByRole("link").first();
    await expect(first, "an applicant file leads the home").toBeVisible();
    const row = await first.boundingBox();
    expect(row && row.y + row.height <= screen.viewport.height, "the first applicant file is on the first screen").toBe(
      true,
    );

    await first.click();
    await expect(page, "the applicant file opens").toHaveURL(/\/app\/dossiers\/[^/?#]+/);
    await page.context().close();
  });
}
