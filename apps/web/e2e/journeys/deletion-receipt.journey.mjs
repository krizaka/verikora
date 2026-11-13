// Journey « deletion-receipt » (journeys.json; krizaka-internal#3381): a property manager closes an applicant file, finds the signed
// deletion receipt on the file's page, downloads it and checks it on the verification page with the report's key. Desktop and phone.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { prepareClosableFile } from "./receipt-fixture.mjs";
import { BASE, openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "deletion-receipt",
);
const ERIC = process.env.E2E_EMAIL ?? "eric@demo.verikora.test";

for (const screen of SCREENS) {
  test(`Eric closes a file, downloads its deletion receipt and verifies it (${screen.name})`, async ({
    browser,
  }, info) => {
    const id = await prepareClosableFile(ERIC);
    const page = await openAs({
      browser,
      info,
      persona: "eric",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: `/fr/app/dossiers/${id}`,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Léa Fictive");
    await expect(page.getByTestId("file-receipts"), "no receipt before anything is deleted").toHaveCount(0);

    // The manager's decision: the file is closed and its document purged from the store and the database.
    const closed = await page.request.post(new URL(`/api/applications/${id}`, BASE).toString(), {
      data: { action: "close" },
      headers: { origin: new URL(BASE).origin },
    });
    expect(closed.ok(), "closing the file answers 200").toBe(true);
    await page.reload();

    const receipts = page.getByTestId("file-receipts");
    await expect(receipts, "the receipt is on the file's page").toBeVisible();
    await expect(receipts).toContainText("Effacé après votre décision");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      receipts.getByTestId("receipt-download").first().click(),
    ]);
    const body = readFileSync(await download.path(), "utf8");
    expect(body, "the receipt holds no name").not.toMatch(/Léa|Fictive|lea@|talon/i);
    expect(JSON.parse(body).payload.rule).toBe("after-decision");

    await page.goto(new URL("/fr/app/verifications/report", BASE).toString());
    await page.locator("textarea").first().fill(body);
    await page.locator("form button[type=submit]").first().click();
    await expect(page.getByTestId("verify-ok"), "the receipt verifies with the report's key").toBeVisible();
    await expect(page.getByTestId("verify-ok")).toContainText("Effacé après la décision du gestionnaire");
    await page.context().close();
  });
}
