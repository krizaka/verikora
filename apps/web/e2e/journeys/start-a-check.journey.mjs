// Journey « start-a-check » (journeys.json; krizaka-internal#1899): Eric drops a document on « Vérifier un document », the question
// « Quel document ? » is in view at once (no scroll, even on a phone), he answers « Bail » and the report opens.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "start-a-check",
);

const PHONE = SCREENS.find((s) => s.viewport.width <= 430) ?? { name: "phone", viewport: { width: 390, height: 844 } };

test(`drop zone is in the viewport at first paint and QC catalogue is first (${PHONE.name})`, async ({
  browser,
}, info) => {
  const page = await openAs({
    browser,
    info,
    persona: "eric",
    screen: PHONE,
    journey: JOURNEY,
    videoContextOptions,
    path: "/fr/app/check",
  });

  const drop = page.getByTestId("check-drop");
  await drop.waitFor({ state: "visible" });
  await expect
    .poll(
      async () => {
        const box = await drop.boundingBox();
        return Boolean(box && box.y >= 0 && box.y + box.height <= PHONE.viewport.height);
      },
      { message: "the drop zone is fully within the 844 px viewport without scrolling" },
    )
    .toBe(true);

  const rows = page.locator('[data-testid="check-catalogue"] li');
  await expect(rows.first(), "the first catalogue item is a Québec check").toContainText("Québec");
  await expect(rows, "a Québec account is offered Québec checks and the file's authenticity, nothing else").toHaveCount(4);
  await expect(page.getByTestId("check-catalogue")).not.toContainText(/France|Wallonie/);

  await page.context().close();
});

for (const screen of SCREENS) {
  test(`the catalogue is filtered to the account's territory (${screen.name})`, async ({ browser }, info) => {
    const page = await openAs({
      browser,
      info,
      persona: "eric",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app/check",
    });
    const catalogue = page.getByTestId("check-catalogue");
    await expect(catalogue.locator("li").first()).toContainText("Québec");
    await expect(catalogue).not.toContainText(/France|Wallonie|Facture|Contrat de service/);
    await page.context().close();
  });

  test(`Eric drops a document, answers « Quel document ? » in view and reaches the report (${screen.name})`, async ({
    browser,
  }, info) => {
    const page = await openAs({
      browser,
      info,
      persona: "eric",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app/check",
    });

    const flow = page.getByTestId("check-flow");
    if (screen.viewport.width >= 1024) {
      await expect(flow, "the four steps are shown before the drop (desktop)").toBeVisible();
    } else {
      await expect(flow, "the flow steps are hidden on phone").toBeHidden();
    }
    // A text the engine cannot place: it asks which document it is.
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "papier.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Un papier sans titre, que Verikora ne reconnaît pas."),
      });

    const question = page.getByTestId("check-kind-question");
    await expect(question, "« Quel document ? » appears").toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const box = await question.boundingBox();
          return Boolean(box && box.y >= 0 && box.y + box.height <= screen.viewport.height);
        },
        { message: "the question is on the screen" },
      )
      .toBe(true);

    await question.getByRole("radio", { name: /Bail/ }).click();
    await expect(page, "the report opens").toHaveURL(/\/app\/documents\/[^/]+\/rapport/, { timeout: 30_000 });
    await page.context().close();
  });
}
