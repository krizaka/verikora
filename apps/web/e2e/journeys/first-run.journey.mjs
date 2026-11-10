// Journey « first-run » (journeys.json; krizaka-internal#1902 updated by #2291): a new account (the cast's Camille: no document, no
// dossier) lands on the welcome screen, starts as a property manager in one click, then lands on a home that teaches: one primary
// action (the drop zone), a sample report, the plan line, and on « Dossiers » an empty state with no tabs, filters or count.
// Run on a desktop and on a phone.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { openAs, resetToNewAccount, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "first-run",
);

// Every test starts as a new account and changes its side: they share Camille, so they run one after the other.
test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  await resetToNewAccount("camille");
});

for (const screen of SCREENS) {
  test(`a new account lands on the welcome screen and starts as a property manager in one click (${screen.name})`, async ({
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

    // The app redirects a new account (no perspective) from /app to /app/welcome.
    await expect(page, "the tab shows the commercial name").toHaveTitle(/Verikora/);
    await expect(page.getByTestId("welcome"), "the welcome screen is shown").toBeVisible();
    await expect(page.getByRole("radiogroup"), "one radio group with a legend").toBeVisible();
    await expect(page.getByRole("radio"), "the owner card is the only one shown").toHaveCount(1);
    await expect(page.getByRole("radio").first(), "the owner card is preselected").toBeChecked();
    await expect(page.getByRole("button", { name: /autre usage/i }), "the disclosure is collapsed").toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByTestId("welcome-start"), "the primary button is visible").toBeVisible();

    // One click: starts as a landlord, lands on the home.
    await page.getByTestId("welcome-start").click();
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

  test(`« Autre usage » unfolds the other sides and the tenant path sets the tenant side (${screen.name})`, async ({
    browser,
  }, info) => {
    const page = await openAs({
      browser,
      info,
      persona: "camille",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app/welcome",
    });

    await expect(page.getByTestId("welcome"), "the welcome screen is shown").toBeVisible();
    // Expand and pick the tenant side.
    const disclosure = page.getByRole("button", { name: /autre usage/i });
    await disclosure.click();
    await expect(disclosure, "disclosure state is announced").toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("radio"), "all four sides are shown").toHaveCount(4);
    await page.getByRole("radio", { name: /locataire/i }).click();
    await page.getByTestId("welcome-start").click();
    // Lands on the home as tenant; perspective is now set.
    await expect(page.getByTestId("library-empty"), "landed on the home").toBeVisible();
    await page.context().close();
  });
}
