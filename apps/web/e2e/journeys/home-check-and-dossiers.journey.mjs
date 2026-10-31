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
  test(`Eric sees « Vérifier un document » and his dossiers on one screen, then opens one (${screen.name})`, async ({
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
    const drop = page.getByTestId("library-dropzone");
    await expect(drop, "the drop zone is on the home").toBeVisible();
    const list = page.getByRole("list", { name: "Vos dossiers" });
    await expect(list.getByRole("link", { name: /Immeuble Rosemont/ }), "his dossiers are listed").toBeVisible();

    const button = page.getByTestId("home-check-button");
    await expect(button, "the primary action is a named button").toHaveText("Vérifier un document");
    const box = await button.boundingBox();
    expect(box && box.y + box.height <= screen.viewport.height, "the primary button is on the first screen").toBe(true);
    const row = await list.getByRole("link").first().boundingBox();
    expect(row && row.y < screen.viewport.height, "the list starts on the first screen").toBe(true);

    await list.getByRole("link", { name: /Immeuble Rosemont/ }).click();
    await expect(page, "the dossier opens").toHaveURL(/\/app\/library\/[^/]+\/[^/?#]+/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Immeuble Rosemont");
    await page.context().close();
  });
}
