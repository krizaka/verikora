import { defineConfig } from "vitest/config";

// The repository's own scripts (the SEO family guard). The apps and packages run their own suites (turbo run test).
export default defineConfig({ test: { include: ["scripts/**/*.test.mjs"], testTimeout: 120_000 } });
