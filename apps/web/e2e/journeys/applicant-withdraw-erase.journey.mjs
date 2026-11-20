// Journey « applicant-withdraw-erase » (journeys.json; krizaka-internal#3432): an applicant opens the link a manager handed over, consents,
// sees the document received, withdraws a consent, then asks for the erasure; the database no longer holds the file. The applicant has
// no account: the page is public by token. The upload and its failed check are not in this slice (they need an engine).
import { readFileSync } from "node:fs";

import { videoContextOptions } from "@krizaka/page-audit/journey";
import { expect, test } from "@playwright/test";

import { activePurposes, heldOf, prepareApplicantLink } from "./applicant-link-fixture.mjs";
import { BASE, SCREENS } from "./session.mjs";

const JOURNEY = JSON.parse(readFileSync(new URL("./journeys.json", import.meta.url), "utf8")).find(
  (j) => j.id === "applicant-withdraw-erase",
);
const ERIC = process.env.E2E_EMAIL ?? "eric@demo.verikora.test";

for (const screen of SCREENS) {
  test(`an applicant consents, withdraws a consent and erases the file (${screen.name})`, async ({ browser }, info) => {
    const { id, token } = await prepareApplicantLink(ERIC);
    const filmed = screen.name === "desktop" ? videoContextOptions(JOURNEY, { dir: info.outputDir }) : {};
    const context = await browser.newContext({ viewport: screen.viewport, ...filmed });
    const page = await context.newPage();

    await page.goto(new URL(`/fr/dossier/${token}`, BASE).toString());
    await expect(page.getByTestId("applicant-file"), "the link opens with no account").toBeVisible();
    await expect(page.getByTestId("asked-pay-stub")).toContainText("talon-noa.txt");

    // Consent to the check, then to the keeping; each is recorded.
    await page.getByTestId("consent-DOCUMENT_CHECK").getByRole("checkbox").click();
    await expect.poll(() => activePurposes(id)).toEqual(["DOCUMENT_CHECK"]);
    await page.getByTestId("consent-DOCUMENT_KEEP").getByRole("checkbox").click();
    await expect.poll(() => activePurposes(id)).toEqual(["DOCUMENT_CHECK", "DOCUMENT_KEEP"]);

    // The withdrawal: the keeping stops, the check stays.
    await page.getByTestId("consent-DOCUMENT_KEEP").getByRole("checkbox").click();
    await expect.poll(() => activePurposes(id), "the withdrawal is recorded").toEqual(["DOCUMENT_CHECK"]);
    expect((await heldOf(id)).documents, "withdrawing a consent is not an erasure").toBe(1);

    // The erasure: asked twice (a confirmation), then the page says so and the rows are gone.
    const erase = page.getByTestId("applicant-erase").getByRole("button");
    await erase.click();
    await erase.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("alert").or(page.getByRole("status")).first()).toBeVisible();
    await expect(page.getByTestId("applicant-erase"), "nothing left to erase").toHaveCount(0);

    const held = await heldOf(id);
    expect(held.documents, "the document is gone").toBe(0);
    expect(held.checks, "the checks are gone").toBe(0);
    expect(held.activeConsents, "no consent stays active").toBe(0);
    expect(held.receipts, "a receipt of the deletion is kept").toBe(1);
    expect(held.screening.status).toBe("erased");
    expect(`${held.screening.tenant_name}${held.screening.tenant_email}`, "no name stays").not.toMatch(
      /Noa|Fictif|noa@/i,
    );
    await context.close();
  });
}
