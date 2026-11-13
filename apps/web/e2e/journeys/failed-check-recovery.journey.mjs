// Journey « failed-check-recovery » (journeys.json; krizaka-internal#1900, #1936): a check that did not finish says why in plain words,
// with no engine name, and Eric can try again or choose another file. The seed holds one failed check per real cause on his account
// (`demo-seed --cast`). Words come from the messages, never typed here. The journeys run without an engine: the retry is proven by
// the request it sends (the same Studio), not by a report.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, sessionsFor } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "failed-check-recovery",
);
const FR = JSON.parse(readFileSync(new URL("../../messages/fr.json", import.meta.url), "utf8")).console;
// Words of the engine room that a person never reads (the engine, a run id, a stack).
const ENGINE_WORDS = /sovkora|engine|moteur|stack ?trace|exception|runId|run id|ENGINE_|seeded-/i;

test("a failed check says why in plain words and offers a way out", async ({ browser }, info) => {
  const state = await sessionsFor(browser, info.workerIndex).stateFor("eric");
  const context = await browser.newContext({
    storageState: state,
    ...videoContextOptions(JOURNEY, { dir: info.outputDir }),
  });
  const page = await context.newPage();

  await page.goto(new URL("/fr/app/verifications", BASE).toString());
  const row = page.getByRole("row").filter({ hasText: FR.statuses.failed }).first();
  await expect(row, "the check that did not finish is in his list").toBeVisible();
  await row.getByRole("link").first().click();

  const failure = page.getByTestId("check-failure");
  await expect(failure, "one status says what happened").toBeVisible();
  await expect(failure.getByText(FR.checkFailure.title)).toBeVisible();
  const words = (await failure.innerText()).trim();
  expect(words.length, "in plain words").toBeGreaterThan(40);
  expect(words, "without an engine name").not.toMatch(ENGINE_WORDS);
  await expect(
    failure.getByText(FR.checkFailure.creditRestored),
    "the credit is given back, and the page says so",
  ).toBeVisible();
  await expect(page.getByText(FR.reportFace.notChecked), "no « not checked yet » next to a failure").toHaveCount(0);

  // Try again: the same check is sent again.
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && /\/api\/documents\/[^/]+$/.test(new URL(r.url()).pathname),
  );
  await failure.getByRole("button", { name: FR.checkFailure.retry }).click();
  const request = await sent;
  expect(request.postDataJSON(), "the same Studio again").toHaveProperty("studio");

  // Choose another file: back to the check page.
  await failure.getByRole("link", { name: FR.checkFailure.chooseFile }).click();
  await expect(page).toHaveURL(/\/fr\/app\/check$/);
  await context.close();
});
