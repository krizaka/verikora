// Journey « invoice-by-role » (journeys.json; krizaka-internal#3979): a landlord is offered the supplier-invoice check and gets a
// report; a tenant is not offered it, so nothing is launched for them and the document page says which roles offer it.
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { DEFAULT_SEED, generateDocument } from "../../../../scripts/demo-documents/index.mjs";
import { BASE, openAs, SCREENS, setPerspective } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "invoice-by-role",
);
const DESKTOP = SCREENS[0];

async function dropInvoice(page) {
  await page.waitForLoadState("networkidle"); // the page is hydrated: a file given before would reach no handler
  const invoice = await generateDocument("facture-2026-01");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: invoice.filename, mimeType: "application/pdf", buffer: Buffer.from(invoice.bytes) });
}

// A drop anywhere on the library: the page's own drop overlay listens on the window, so the files travel as a real drop event.
// Each run drops an invoice of its own (a seed of its own), so the file is new and never a duplicate of an earlier run.
async function dropInvoiceOnLibrary(page) {
  const invoice = await generateDocument("facture-2026-01", DEFAULT_SEED + 1 + (Date.now() % 1_000_000));
  await page.evaluate(
    ({ name, bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        globalThis.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    },
    { name: invoice.filename, bytes: Array.from(invoice.bytes) },
  );
}

const documentIds = async (page) =>
  (await (await page.request.get(new URL("/api/documents", BASE).toString())).json()).documents.map((d) => d.id);

/** Drops an invoice anywhere on the library and returns the id of the document that landed (the one the account did not hold before). */
async function dropAndFind(page) {
  await page.waitForLoadState("networkidle");
  const before = new Set(await documentIds(page));
  await dropInvoiceOnLibrary(page);
  let landed = null;
  await expect
    .poll(
      async () => {
        landed = (await documentIds(page)).find((id) => !before.has(id)) ?? null;
        return landed;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();
  // The tray says « terminée » once the check was started (or refused): leaving the page earlier would cut that step short.
  await expect(page.getByTestId("upload-tray")).toContainText(/1 terminée/, { timeout: 60_000 });
  return landed;
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

// krizaka-internal#4028: a foreign SaaS invoice (Stripe layout, USD, QST and GST charged, no registration numbers) whose text layer holds
// U+0000 was stored as « unreadable ». It is read, and its report opens with the findings.
test("a landlord drops a Stripe-style USD invoice: it is read and the report holds its findings", async ({
  browser,
}, info) => {
  const page = await openCheckAs(browser, info, "landlord");
  await page.waitForLoadState("networkidle");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "invoice-synthetic-usd.pdf",
      mimeType: "application/pdf",
      buffer: readFileSync(
        new URL("../../../../fixtures/stripe-like-invoice/invoice-synthetic-usd.pdf", import.meta.url),
      ),
    });
  await expect(page, "the report opens").toHaveURL(/\/app\/documents\/[^/]+\/rapport/, { timeout: 60_000 });
  expect(page.url(), "no refusal is carried in the address").not.toContain("refused=");
  await expect(page.getByText(/endommagé|n’est pas un document valide/), "the file is read").toHaveCount(0);
  await expect(page.getByText("À regarder").first(), "the report holds its findings").toBeVisible({ timeout: 60_000 });
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

test("a landlord drops an invoice on the library: the check starts on its own and the report is there", async ({
  browser,
}, info) => {
  await setPerspective("eric", "landlord");
  const page = await openAs({
    browser,
    info,
    persona: "eric",
    screen: DESKTOP,
    journey: JOURNEY,
    videoContextOptions,
    path: "/fr/app",
  });
  const id = await dropAndFind(page);
  // The check runs after the upload answered: the report page is opened again until it holds its findings.
  await expect(async () => {
    await page.goto(`/fr/app/documents/${id}/rapport`);
    await expect(page.getByText("À regarder").first(), "the report holds its findings").toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId("check-not-offered")).toHaveCount(0);
  await page.context().close();
});

test("a tenant drops the invoice on the library: no check is started, the page says which roles offer it", async ({
  browser,
}, info) => {
  await setPerspective("eric", "tenant");
  const page = await openAs({
    browser,
    info,
    persona: "eric",
    screen: DESKTOP,
    journey: JOURNEY,
    videoContextOptions,
    path: "/fr/app",
  });
  const id = await dropAndFind(page);
  const notOffered = page.getByTestId("check-not-offered");
  await expect(async () => {
    await page.goto(`/fr/app/documents/${id}/rapport`);
    await expect(notOffered).toContainText("Entreprise", { timeout: 3000 });
  }).toPass({ timeout: 60_000 });
  await expect(notOffered.getByRole("link", { name: "Changer de rôle" })).toBeVisible();
  await expect(page.getByText("À regarder"), "no check was launched: no finding").toHaveCount(0);
  await page.context().close();
});
