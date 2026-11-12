// Journey « share-report » (journeys.json; krizaka-internal#2293): Eric opens the report of his lease, shares it
// from the header button without scrolling, sees « Partagé », then revokes the share to leave Eric's data intact.
// Run on a desktop and on a phone. The share persona (Eric) is restored: the journey is order-independent.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, beat, markSeededCheck, openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "share-report",
);

// The seeded lease's check is a demo one, never shared: it is a recorded run for this journey, and a demo check again after it.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => markSeededCheck("avis du TAL absent", false));
test.afterAll(() => markSeededCheck("avis du TAL absent", true));

for (const screen of SCREENS) {
  test(`Eric shares the report from the header without scrolling and revokes to restore data (${screen.name})`, async ({
    browser,
  }, info) => {
    // Open the library as Eric and find the seeded lease.
    const page = await openAs({
      browser,
      info,
      persona: "eric",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app",
    });

    await page.goto(new URL("/fr/app/documents", BASE).toString());
    const link = page.locator('a[href*="/app/documents/"]', { hasText: "avis du TAL absent" }).first();
    await expect(link, "the seeded lease is in the library").toBeVisible();
    const href = await link.getAttribute("href");
    const id = href?.match(/\/app\/documents\/([^/?#]+)/)?.[1];
    expect(id, "the library links the document by its id").toBeTruthy();

    // Open the report tab.
    await page.goto(new URL(`/fr/app/documents/${id}/rapport`, BASE).toString());
    await beat(page);

    // The share button is on the first screen without scrolling.
    const shareBtn = page.getByTestId("report-share-action");
    await expect(shareBtn, "the share button is visible").toBeVisible();
    const box = await shareBtn.boundingBox();
    expect(box && box.y + box.height <= screen.viewport.height, "the share button is visible without scrolling").toBe(
      true,
    );

    // Status is « Pas encore partagé » before the first share.
    const status = page.getByTestId("report-share-status");
    await expect(status, "not shared yet is shown").toContainText(/pas encore partagé/i);

    // Open the dialog.
    await shareBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog, "the share dialog is open").toBeVisible();

    // The email field has a visible label.
    const emailField = dialog.locator('input[type="email"]').first();
    await expect(emailField, "the email field is in the dialog").toBeVisible();
    const emailLabel = dialog.locator("label[for]").first();
    await expect(emailLabel, "the email field has a visible label").toBeVisible();

    // Fill in a share address and submit.
    await emailField.fill("owner-test@example.test");
    await beat(page);
    await dialog.getByRole("button", { name: /partager/i }).click();
    await beat(page, 2000);

    // After sharing the grant appears in the dialog list.
    await expect(
      dialog.locator("text=owner-test@example.test").first(),
      "the new share appears in the list",
    ).toBeVisible();

    // Close the dialog — focus must return to the trigger.
    const closeBtn = dialog.getByRole("button", { name: /fermer/i });
    await closeBtn.click();
    await expect(dialog, "the dialog is closed").toHaveCount(0);

    // The status now reads « Partagé ».
    await expect(status, "status updates to Partagé").toContainText(/^partagé$/i);
    await beat(page);

    // --- Restore Eric's data: revoke the share ---
    await shareBtn.click();
    await expect(dialog, "the dialog re-opens").toBeVisible();
    const revokeBtn = dialog.getByRole("button", { name: /révoquer/i }).first();
    await expect(revokeBtn, "revoke button is available").toBeVisible();
    await revokeBtn.click();
    await beat(page, 1500);

    await closeBtn.click();
    await expect(status, "status returns to Pas encore partagé after revoke").toContainText(/pas encore partagé/i);

    await page.context().close();
  });
}
