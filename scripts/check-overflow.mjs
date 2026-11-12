#!/usr/bin/env node
// Responsive guard: no horizontal overflow, and no tap target under 44 px in the « Pour qui ? » chips, at every width that
// matters, in both themes and both languages, on the pages a visitor lands on.
//
//   node scripts/check-overflow.mjs --base http://localhost:3111 [--shots <dir>]
//
// Also fails on a console error or an uncaught exception (a hydration mismatch is one: React error #418).
// Exits 1 listing every page × width × theme that overflows. With --shots it also writes a screenshot of each.
import { fileURLToPath } from "node:url";

import { auditRoutes, THEMES, WIDTHS } from "@krizaka/page-audit";

export { THEMES, WIDTHS };
export const PAGES = [
  "/en",
  "/fr",
  "/en/privacy",
  "/fr/privacy",
  "/en/docs",
  "/fr/docs",
  "/en/sign-in",
  "/fr/sign-in",
  "/en/sign-up",
  "/fr/sign-up",
  "/en/forgot-password",
  "/fr/forgot-password",
  `/en/reset-password?token=ye1.${"A".repeat(43)}`,
  "/fr/reset-password",
  "/fr/verify",
  "/fr/nope",
  "/en/nope",
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

// axe-core (WCAG 2.1 AA) runs at the phone and the desktop width only; the ratchet baseline is the repo's own.
export const A11Y_WIDTHS = [390, 1440];
export const A11Y_BASELINE = fileURLToPath(new URL("../a11y-baseline.json", import.meta.url));
export const check = ({ base, shots }) =>
  auditRoutes({
    base,
    routes: PAGES,
    widths: WIDTHS,
    themes: THEMES,
    shots,
    a11y: { app: "verikora", baseline: A11Y_BASELINE, widths: A11Y_WIDTHS },
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await check({ base: arg("base", "http://localhost:3000"), shots: arg("shots") });
  if (problems.length) {
    console.error(`${problems.length} responsive problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    `no horizontal overflow, tap targets >= 44 px: ${PAGES.length} pages x ${WIDTHS.length} widths x ${THEMES.length} themes`,
  );
}
