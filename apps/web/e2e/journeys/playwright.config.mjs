// The customer journeys of Verikora (ADR-017, krizaka/.github#423), run as the seeded cast against the built app by
// scripts/ci-visual-start.sh (the cast is seeded there). The kit is @krizaka/page-audit/journey; nothing of it is copied here.
import { assertNoRetries } from "@krizaka/page-audit/journey";
import { defineConfig } from "@playwright/test";

const config = {
  testDir: ".",
  testMatch: "**/*.journey.mjs",
  outputDir: "../../test-results/journeys",
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../playwright-report/journeys" }]],
  workers: 2,
  retries: 0, // a flaky journey is a bug: fixed, or quarantined with an issue (the kit's cap), never retried
  timeout: 90_000,
  use: { baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:3000" },
};
assertNoRetries(config);
export default defineConfig(config);
