// pnpm build:public — the public static export of Verikora (krizaka-internal#4148).
// It stages a Next project (apps/web/.public-build) whose `app/` links the REAL page files of the public routes (never copies),
// builds it with `output: "export"` and leaves the result in apps/web/out-public. The dev app and its build are untouched.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_SHARED_ENTRIES, stagedAppFiles } from "../lib/public-build/routes.mjs";
import { checkRoutes } from "./check-public-export.mjs";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(WEB, ".public-build");
const OUT = join(WEB, "out-public");

/** A relative link: the staged folder follows the repository wherever it is checked out. */
function link(target, at) {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(relative(dirname(at), target), at);
}

function stage() {
  mkdirSync(STAGE, { recursive: true });
  // Everything but Next's own cache (`.next`) is rebuilt: the links follow the list of routes, and the cache keeps the next build quick.
  for (const entry of readdirSync(STAGE))
    if (entry !== ".next") rmSync(join(STAGE, entry), { recursive: true, force: true });
  for (const file of stagedAppFiles()) link(join(WEB, "app", file), join(STAGE, "app", file));
  for (const entry of PUBLIC_SHARED_ENTRIES) link(join(WEB, entry), join(STAGE, entry));
  link(join(WEB, "next.config.public.mjs"), join(STAGE, "next.config.mjs"));
  link(join(WEB, "node_modules"), join(STAGE, "node_modules"));
  // The app's own tsconfig, narrowed to the staged pages (its `@/*` paths still resolve in apps/web): the type check reads what is exported.
  writeFileSync(
    join(STAGE, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../tsconfig.json",
        include: ["next-env.d.ts", "app/**/*.ts", "app/**/*.tsx"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
  );
  // A static export runs nothing at start-up: the app's instrumentation (database, ticks) is not part of it.
  writeFileSync(join(STAGE, "instrumentation.ts"), "export function register() {}\n");
}

function build() {
  const next = join(WEB, "node_modules", ".bin", "next");
  execFileSync(next, ["build"], {
    cwd: STAGE,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  });
}

stage();
build();
rmSync(OUT, { recursive: true, force: true });
if (!existsSync(join(STAGE, "out"))) throw new Error("the export produced no out/ folder");
cpSync(join(STAGE, "out"), OUT, { recursive: true });
const problems = checkRoutes(OUT);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`public export ready: ${relative(process.cwd(), OUT) || OUT}`);
