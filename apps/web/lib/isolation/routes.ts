import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The route table, read from the file tree (krizaka-internal#2382, #2383): one list for every guard that must cover each route —
 * customer isolation (`route-coverage.test.ts`) and the authorization matrix (`authorization-coverage.test.ts`). Never typed from
 * memory: a new `route.ts` or a new exported method shows up here, and each guard fails until it has its row. Test support only.
 */
export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];
/** `METHOD /api/path`, the key of every route table. */
export type RouteKey = `${Method} /${string}`;

/** Every file named `file` under `dir`, as absolute paths, in a stable order. */
export async function walk(dir: string, file: string): Promise<string[]> {
  const all = await readdir(dir, { recursive: true });
  return all
    .filter((rel) => path.basename(rel) === file)
    .map((rel) => path.join(dir, rel))
    .sort();
}

/** The methods a route file exports: `export function GET`, `export const GET =`, `export const { PATCH, DELETE } =` (Prettier's spacing). */
export function methodsOf(source: string): Method[] {
  const named = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/gm)].map((m) => m[1]!);
  const destructured = [...source.matchAll(/^export const \{([^}]+)\} =/gm)].flatMap((m) =>
    m[1]!.split(",").map((s) => s.trim()),
  );
  return [...named, ...destructured].filter((m): m is Method => (METHODS as readonly string[]).includes(m));
}

/** A segment that is a value: `[id]`, `[token]`; `[locale]` and a catch-all are not. */
export const hasIdSegment = (folder: string): boolean =>
  folder
    .split("/")
    .some((seg) => seg.startsWith("[") && seg.endsWith("]") && seg !== "[locale]" && !seg.startsWith("[..."));
/** An id read from the request body: a zod field `…Id(s)` / `ids`, a multipart `…Id` field, the container handlers' parent id. */
const names = (source: string, re: RegExp) => [...source.matchAll(re)].map((m) => m[1]!);
const takesBodyId = (source: string) =>
  names(source, /\b(\w+)\s*:\s*z\./g).some((n) => n === "ids" || /[a-z]Ids?$/.test(n)) ||
  names(source, /stringField\(\s*form,\s*"(\w+)"/g).some((n) => /[a-z]Id$/.test(n)) ||
  /\bcontainerHandlers\(/.test(source);

export interface Route {
  /** `/api/…`, with its `[segments]` */
  path: string;
  /** the `route.ts` file */
  file: string;
  methods: Method[];
  idInPath: boolean;
  idInBody: boolean;
}

/** Every route handler of the app, with the methods it exports. */
export const apiRoutes = async (): Promise<Route[]> =>
  Promise.all(
    (await walk(path.join(APP, "api"), "route.ts")).map(async (file) => {
      const source = await readFile(file, "utf8");
      const routePath = `/${path.relative(APP, path.dirname(file)).split(path.sep).join("/")}`;
      return {
        path: routePath,
        file,
        methods: methodsOf(source),
        idInPath: hasIdSegment(routePath),
        idInBody: takesBodyId(source),
      };
    }),
  );

/** Every `METHOD /path` the app answers. */
export const routeKeys = (routes: Route[]): RouteKey[] =>
  routes.flatMap((r) => r.methods.map((m) => `${m} ${r.path}` as RouteKey));

/** Every page of the app, as its folder under `app/` (`[locale]/(admin)/console/(signed)/users/[id]`). */
export const pagePaths = async (): Promise<string[]> =>
  (await walk(APP, "page.tsx")).map((f) => path.relative(APP, path.dirname(f)).split(path.sep).join("/"));
