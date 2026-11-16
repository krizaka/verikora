// Journey « tag-a-document » (journeys.json; krizaka-internal#3994): Eric opens a collection, tags one of its documents with a NEW red tag in
// the one tags dialog (no second dialog on top), and the row shows the chip: a red marker and the name. The tag is then deleted to restore
// Eric's data: the journey is order-independent. Run on a desktop and on a phone.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, beat, openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "tag-a-document",
);
const NAME = "Journey rouge";

/** Deletes the tag the journey made through the signed-in page's own session (the library's one list, `/api/organize/document/tags`). */
async function removeTag(page) {
  await page.evaluate(async (name) => {
    const res = await fetch("/api/organize/document/tags");
    if (!res.ok) throw new Error(`tags list ${res.status}: ${await res.text()}`);
    const { tags } = await res.json();
    for (const tag of tags.filter((t) => t.name === name)) {
      await fetch(`/api/organize/document/tags/${tag.id}`, { method: "DELETE" });
    }
  }, NAME);
}

test.describe.configure({ mode: "serial" });

for (const screen of SCREENS) {
  test(`Eric tags a document with a new red tag in one dialog and sees its marker and name (${screen.name})`, async ({
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
    try {
      await removeTag(page);
      await page.goto(new URL("/fr/app", BASE).toString());
      await page
        .getByRole("link", { name: /Immeuble Rosemont/ })
        .first()
        .click();
      // On a phone a row folds its details (the actions among them) under « Show more about … »: open the first document's.
      const more = page.getByRole("button", { name: /^Show more about/ }).first();
      if (screen.name === "phone") {
        await more.click();
      }
      const row = page.getByRole("button", { name: /^Actions pour (?!Immeuble)/ }).first();
      await expect(row, "a document of the collection has its actions menu").toBeVisible();
      await row.click();
      await page.getByRole("menuitem", { name: "Modifier les étiquettes" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog, "one dialog holds the tags").toHaveCount(1);
      await dialog.getByRole("textbox", { name: "Ajouter une étiquette" }).fill(NAME);
      await dialog.getByRole("radio", { name: "Rouge" }).click();
      await dialog.getByRole("button", { name: `Créer « ${NAME} »` }).click();
      await expect(page.getByRole("dialog"), "creating the tag opens no second dialog").toHaveCount(1);
      await expect(
        dialog.getByRole("button", { name: NAME }),
        "the new tag is chosen in the same dialog",
      ).toHaveAttribute("aria-pressed", "true");
      await beat(page);
      await dialog.getByRole("button", { name: "Enregistrer" }).click();
      await expect(dialog, "the dialog closes once saved").toHaveCount(0);

      const chip = page.getByText(NAME, { exact: true }).locator("visible=true").first();
      await expect(page.getByText(NAME, { exact: true }).first(), "the page refreshed with the tag").toBeAttached();
      if (screen.name === "phone" && !(await chip.isVisible())) {
        await more.click(); // the refresh folds the row again
      }
      await expect(chip, "the document row wears the new tag, its name written").toBeVisible();
      await expect(
        page.locator("li", { has: chip }).locator("[data-marker='red']").first(),
        "its marker is the red of the palette",
      ).toBeAttached();
    } finally {
      await removeTag(page);
      await page.context().close();
    }
  });
}
