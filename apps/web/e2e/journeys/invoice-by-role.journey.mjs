// Journey « invoice-by-role » (journeys.json; krizaka-internal#3979): a landlord is offered the supplier-invoice check and gets a
// report; a tenant is not offered it, so nothing is launched for them and the document page says which roles offer it.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { generateDocument } from "../../../../scripts/demo-documents/index.mjs";
import { openAs, SCREENS, setPerspective } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "invoice-by-role",
);
const DESKTOP = SCREENS[0];

async function dropInvoice(page) {
  const invoice = await generateDocument("facture-2026-01");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: invoice.filename, mimeType: "application/pdf", buffer: Buffer.from(invoice.bytes) });
}

async function openCheckAs(browser, info, perspective) {
  await setPerspective("eric", perspective);
  return openAs({
    browser,
    info,
    persona: "eric",
    screen: DESKTOP,
    journey: JOURNEY,
    videoContextOptions,
    path: "/fr/app/check",
  });
}

test.afterAll(async () => {
  await setPerspective("eric", "landlord");
});

test("a landlord drops a supplier invoice and the check is started: the report opens", async ({ browser }, info) => {
  const page = await openCheckAs(browser, info, "landlord");
  await dropInvoice(page);
  await expect(page, "the report opens").toHaveURL(/\/app\/documents\/[^/]+\/rapport/, { timeout: 60_000 });
  expect(page.url(), "no refusal is carried in the address").not.toContain("refused=");
  await expect(page.getByTestId("check-not-offered")).toHaveCount(0);
  await page.context().close();
});

test("a tenant drops the same invoice: no check is launched, the page says which roles offer it", async ({
  browser,
}, info) => {
  const page = await openCheckAs(browser, info, "tenant");
  await dropInvoice(page);
  await expect(page, "the report opens on the refusal").toHaveURL(/\/rapport\?refused=FLOW_NOT_OFFERED/, {
    timeout: 60_000,
  });
  const notOffered = page.getByTestId("check-not-offered");
  await expect(notOffered).toContainText("Entreprise");
  await expect(notOffered.getByRole("link", { name: "Changer de rôle" })).toHaveAttribute(
    "href",
    /\/app\/settings\/profil$/,
  );
  await page.context().close();
});
