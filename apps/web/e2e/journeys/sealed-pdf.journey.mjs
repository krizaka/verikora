// Journey « sealed-pdf » (journeys.json; krizaka-internal#2380): Eric downloads the signed PDF Verikora sells for a finished check, uploads
// it on the verification page and sees its seal verified (the product's own verification, /api/verify); a copy with one byte changed fails.
// The purchase itself (test mode) is the checkout journey's (#2375); here the persona holds a recorded check and takes its PDF.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { BASE, markSeededCheck, openAs, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "sealed-pdf",
);
const ATTESTATION = Buffer.from("/VerikoraAttestation (", "latin1");

/** The same file with one byte of its seal changed to another base64 character: the smallest possible alteration. */
function withOneByteChanged(bytes) {
  const at = bytes.indexOf(ATTESTATION);
  if (at < 0) throw new Error("the PDF carries no Verikora seal");
  const index = at + ATTESTATION.length + 40;
  const copy = Buffer.from(bytes);
  copy[index] = copy[index] === 0x41 ? 0x42 : 0x41; // « A », or « B » when it was one
  return copy;
}

// The seeded check is a demo one, which is never sealed: it is a recorded run for this journey, and a demo check again after it.
test.describe.configure({ mode: "serial" });
test.beforeAll(() => markSeededCheck("logement 5 (clause illégale)", false));
test.afterAll(() => markSeededCheck("logement 5 (clause illégale)", true));

for (const screen of SCREENS) {
  test(`Eric downloads the sealed PDF and its seal verifies; one altered byte fails (${screen.name})`, async ({
    browser,
  }, info) => {
    const page = await openAs({
      browser,
      info,
      persona: "eric",
      screen,
      journey: JOURNEY,
      videoContextOptions,
      path: "/fr/app/documents",
    });
    const link = page.locator('a[href*="/app/documents/"]', { hasText: "logement 5 (clause illégale)" }).first();
    await expect(
      link,
      "the seeded lease with an illegal clause (no other journey shares it) is in the library",
    ).toBeVisible();
    const id = (await link.getAttribute("href"))?.match(/\/app\/documents\/([^/?#]+)/)?.[1];
    expect(id, "the library links the document by its id").toBeTruthy();
    await page.goto(new URL(`/fr/app/documents/${id}/rapport`, BASE).toString());

    // The PDF the report page offers, from its menu: the file a customer takes away.
    await page.getByTestId("document-menu").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "Télécharger le PDF" }).click(),
    ]);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1"), "the download is a PDF").toBe("%PDF-");

    const verify = async (name, body) => {
      await page.goto(new URL("/fr/app/verifications/report", BASE).toString());
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name, mimeType: "application/pdf", buffer: body });
      await page.locator("form button[type=submit]").first().click();
    };

    await verify(download.suggestedFilename(), bytes);
    await expect(page.getByTestId("verify-ok"), "the seal of the PDF Verikora sells verifies").toBeVisible();
    await expect(page.getByTestId("verify-failed")).toHaveCount(0);

    await verify("altere.pdf", withOneByteChanged(bytes));
    await expect(page.getByTestId("verify-failed"), "one altered byte breaks the seal").toBeVisible();
    await expect(page.getByTestId("verify-ok")).toHaveCount(0);
    await page.context().close();
  });
}
