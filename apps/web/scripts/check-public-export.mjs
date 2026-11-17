// The export check of the public build (krizaka-internal#4148): lists the exported HTML pages and fails on any route outside
// lib/public-build/routes.mjs, any missing route, and any sign-in, /api/, dev host or session cookie code in the output.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_ROUTES } from "../lib/public-build/routes.mjs";

/** What the output may never carry: each is a way in to something that does not exist on the public site. */
export const FORBIDDEN = [
  { name: "sign-in", pattern: /sign-in/i },
  { name: "/api/", pattern: /\/api\//i },
  { name: "dev. host", pattern: /(?:^|[/"'`\s@])dev\.[a-z0-9-]+\.[a-z]{2,}/i },
  { name: "session cookie", pattern: /verikora_session|session-cookie|sessionHint/i },
];
/**
 * The Krizaka family registry of @krizaka/ui (`site-footer`, a client module the footer needs) lists the dev address of each product
 * as data. It ships in a script chunk, never in a page and never as a link. Only those four addresses are tolerated, and only in
 * scripts: any other dev address, or one in an HTML page, fails.
 */
const FAMILY_REGISTRY_DEV_HOSTS = /https:\/\/dev\.(?:verikora|folioviv|sovkora|kridoc)\.com/g;
const TEXT = /\.(html|js|css|txt|json|xml|webmanifest|map)$/;
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

/** The problems of an export folder (empty = it holds the public pages and nothing else). */
export function checkExport(dir) {
  const all = files(dir);
  const found = all
    .filter((f) => f.endsWith(".html"))
    .map((f) => routeOf(dir, f))
    .filter((r) => !NOT_ROUTES.has(r));
  const problems = [];
  for (const route of found)
    if (!PUBLIC_ROUTES.includes(route)) problems.push(`route outside the public list: ${route}`);
  for (const route of PUBLIC_ROUTES) if (!found.includes(route)) problems.push(`missing public route: ${route}`);
  for (const file of all.filter((f) => TEXT.test(f))) {
    const page = file.endsWith(".html");
    const raw = readFileSync(file, "utf8");
    const text = page ? raw : raw.replace(FAMILY_REGISTRY_DEV_HOSTS, "");
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(text)) problems.push(`${name} in ${relative(dir, file)}`);
    }
  }
  return problems;
}

/** The export folder named on the command line, bounded to the app: a path that leaves it is refused, never read. */
export function exportDirOf(arg, appDir) {
  const dir = resolve(appDir, arg ?? "out-public");
  const rel = relative(appDir, dir);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`export folder outside the app: ${arg}`);
  return dir;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = exportDirOf(process.argv[2], resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const problems = checkExport(dir);
  if (problems.length) {
    console.error(problems.map((p) => `✗ ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`export check passed: ${PUBLIC_ROUTES.length} routes, nothing else`);
}
