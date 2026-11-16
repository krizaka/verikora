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
  const bytes = Array.from(invoice.bytes);
  await page.evaluate(
    ({ name, bytes: data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], name, { type: "application/pdf" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        globalThis.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    },
    { name: invoice.filename, bytes },
  );
  return invoice.filename;
}

/** The newest document of the signed-in account with this file name, once the library's upload landed. */
async function newestDocumentId(page, filename) {
  let id = null;
  await expect
    .poll(
      async () => {
        const body = await (await page.request.get(new URL("/api/documents", BASE).toString())).json();
        id = body.documents.find((d) => d.filename === filename)?.id ?? null;
        return id;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();
  return id;
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
  const id = await newestDocumentId(page, await dropInvoiceOnLibrary(page));
  await page.goto(`/fr/app/documents/${id}/rapport`);
  await expect(page.getByTestId("check-not-offered")).toHaveCount(0);
  await expect(page.getByText("À regarder").first(), "the report holds its findings").toBeVisible({ timeout: 60_000 });
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
  const id = await newestDocumentId(page, await dropInvoiceOnLibrary(page));
  await page.goto(`/fr/app/documents/${id}/rapport`);
  const notOffered = page.getByTestId("check-not-offered");
  await expect(notOffered).toContainText("Entreprise", { timeout: 60_000 });
  await expect(notOffered.getByRole("link", { name: "Changer de rôle" })).toBeVisible();
  await page.context().close();
});
