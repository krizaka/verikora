// Journey « first-run » (journeys.json; krizaka-internal#1902): a new account (the cast's Camille: no document, no dossier) lands on a
// home that teaches: one primary action (the drop zone), a sample report, the plan line, and on « Dossiers » an empty state with no
// tabs, filters or count. Run on a desktop and on a phone.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "first-run",
);

for (const screen of SCREENS) {
  test(`a new account sees one action, a sample report and its plan, and no wall of filters (${screen.name})`, async ({
    browser,
  }, info) => {
    const page = await openAs({
      browser,
      info,
      persona: "camille",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app",
    });

    // The commercial name is what the tab and the bar show; the code name never is (krizaka-internal#2038).
    await expect(page, "the tab shows the commercial name").toHaveTitle(/Verikora/);
    await expect(page, "the tab never shows the code name").not.toHaveTitle(/verikora/i);
    await expect(
      page.getByRole("banner").getByText("Verikora").first(),
      "the bar shows the commercial name",
    ).toBeVisible();
    await expect(page.getByTestId("library-empty"), "the first run is the teaching empty state").toBeVisible();
    const drop = page.getByTestId("library-dropzone");
    await expect(drop, "the drop zone is the one action").toBeVisible();
    const box = await drop.boundingBox();
    expect(box && box.y + box.height <= screen.viewport.height, "the drop zone is on the first screen").toBe(true);
    await expect(page.getByTestId("library-sample-report"), "a sample report is offered").toBeVisible();
    await expect(
      page.getByTestId("library-empty-dossiers"),
      "the empty dossiers say what they will hold",
    ).toBeVisible();
    await expect(page.getByTestId("credits"), "the plan is one line").toBeVisible();

    await page.goto(new URL("/fr/app/dossiers", page.url()).toString());
    await expect(page.getByTestId("files-empty"), "an empty list is an empty state").toBeVisible();
    await expect(page.getByTestId("files-filters"), "no filter bar over nothing").toHaveCount(0);
    await page.context().close();
  });
}
