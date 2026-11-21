// The export check of the public build (krizaka-internal#4148): the routes against lib/public-build/routes.mjs, then the
// shared guard of @krizaka/config (`krizaka-export-guard`, krizaka-internal#4623) for everything the pages carry.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_ROUTES } from "../lib/public-build/routes.mjs";

/** HTML that is not a route: the static host's 404 page (Next writes it twice). */
const NOT_ROUTES = new Set(["/404", "/_not-found"]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** `fr/docs/index.html` and `fr/docs.html` are the route `/fr/docs`. */
export function routeOf(dir, file) {
  const rel = relative(dir, file)
    .replaceAll("\\", "/")
    .replace(/\.html$/, "");
  const route = `/${rel.replace(/(^|\/)index$/, "")}`.replace(/\/$/, "");
  return route === "" ? "/" : route;
}

/** The route problems of an export folder (empty = it holds exactly the public routes). */
export function checkRoutes(dir) {
  const found = files(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => routeOf(dir, f))
    .filter((r) => !NOT_ROUTES.has(r));
  const problems = [];
  for (const route of found)
    if (!PUBLIC_ROUTES.includes(route)) problems.push(`route outside the public list: ${route}`);
  for (const route of PUBLIC_ROUTES) if (!found.includes(route)) problems.push(`missing public route: ${route}`);
  return problems;
}

/** The export folder named on the command line, bounded to the app: a path that leaves it is refused, never read. */
export function exportDirOf(arg, appDir) {
  const dir = resolve(appDir, arg ?? "out-public");
  const rel = relative(appDir, dir);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`export folder outside the app: ${arg}`);
  return dir;
}

/** The argv of `krizaka-export-guard` for Verikora: its status and retired code names come from @krizaka/org (the bin cannot import that ESM-only package itself). */
export function guardArgs(dir, orgModule) {
  const status = orgModule.org.products.find((p) => p.id === "verikora")?.status;
  if (!status) throw new Error("verikora has no status in @krizaka/org");
  const codeNames = Object.keys(orgModule.CODE_NAMES).flatMap((name) => ["--code-name", name]);
  return [dir, "--product", "verikora", "--status", status, ...codeNames];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = exportDirOf(process.argv[2], appDir);
  const problems = checkRoutes(dir);
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join("\n"));
    process.exit(1);
  }
  const org = await import("@krizaka/org");
  // The bin reads a folder inside its working directory: the app.
  const run = spawnSync("pnpm", ["exec", "krizaka-export-guard", ...guardArgs(relative(appDir, dir), org)], {
    cwd: appDir,
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}
