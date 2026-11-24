import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { generateDocument } from "../demo-documents/index.mjs";
import { DEFAULT_EMAILS, PERSONAS, seededReport } from "./seed.mjs";

const DEMO = "demo-landlord";

test("the landlord demo persona holds one sample lease, checked, and no candidate collection or file", () => {
  const def = PERSONAS[DEMO];
  expect(def.perspective).toBe("landlord");
  expect(def.applicantFile).toBe(false);
  expect(def.collections).toHaveLength(1);
  const [only] = def.collections;
  expect(only.documents).toHaveLength(1);
  expect(def.checked).toEqual(only.documents);
  expect(only.documents[0]).not.toMatch(/villeray|paie|banque|emploi/);
  expect(DEFAULT_EMAILS[DEMO]).toBe("demo-landlord@demo.verikora.test");
});

test("the landlord demo persona is never an administrator (the seed gives no role)", () => {
  expect(PERSONAS[DEMO].role).toBeUndefined();
});

test("the sample lease's report is read from the landlord's side and cites the Civil Code", async () => {
  const id = PERSONAS[DEMO].collections[0].documents[0];
  const doc = await generateDocument(id);
  const report = seededReport(doc);
  const text = JSON.stringify(report);
  expect(text).toMatch(/Code civil du Québec/);
  expect(text).toMatch(/art\. 1899 et 1904/);
  expect(text).toMatch(/locateur/);
  expect(report.findings.some((f) => f.ruleId.startsWith("TS-"))).toBe(false);
});

test("both catalogues name the persona's collection", () => {
  for (const locale of ["fr", "en"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../apps/web/messages/${locale}.json`, import.meta.url), "utf8"),
    );
    expect(messages.demo[DEMO].collections.lease.name).toBeTruthy();
  }
});
