import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL(".", import.meta.url)) };
const include = ["lib/**/*.test.ts", "app/**/*.test.{ts,tsx}", "*.test.ts", "components/**/*.test.{ts,tsx}"];
// The files that share the one PostgreSQL of the run. They share its global rows too (the settings test closes the app for maintenance,
// the flows test seeds): side by side they read each other's state (503 MAINTENANCE in an unrelated file), so they run one at a time.
// @fixed: a test that reads many files (route list, name combinations) outlasts the 5 s default when the machine is busy; the bound is a technical margin, not a business value
const TIMEOUT_MS = 30_000;
// The public export's staged project links these same files (scripts/build-public.mjs): its links are not a second suite.
const generated = [".public-build/**", "out-public/**"];
const database = ["**/*.integration.test.ts", "lib/applicant-consent.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include,
          exclude: [...database, ...generated],
          environment: "node",
          testTimeout: TIMEOUT_MS,
        },
      },
      {
        resolve: { alias },
        test: { name: "database", include: database, exclude: generated, environment: "node", fileParallelism: false },
      },
    ],
  },
});
