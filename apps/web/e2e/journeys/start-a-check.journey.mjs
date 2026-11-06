// Journey « start-a-check » (journeys.json; krizaka-internal#1899): Eric drops a document on « Vérifier un document », the question
// « Quel document ? » is in view at once (no scroll, even on a phone), he answers « Bail » and the report opens.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "start-a-check",
);

for (const screen of SCREENS) {
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

    page.on("response", (r) => {
      if (r.url().includes("/api/")) console.log("DBG", r.status(), r.request().method(), r.url().slice(0, 120));
    });
    page.on("requestfailed", (r) => console.log("DBG failed", r.url().slice(0, 120), r.failure()?.errorText));
    page.on("console", (m) => {
      if (m.type() === "error") console.log("DBG console", m.text().slice(0, 200));
    });
    const flow = page.getByTestId("check-flow");
    await expect(flow, "the four steps are shown before the drop").toBeVisible();
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
