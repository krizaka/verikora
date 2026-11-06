import { readFileSync } from "node:fs";

/** @typedef {{ source: string, destination: string, permanent: true }} RemovedRule */

/**
 * The public addresses this site no longer serves, and where each one went (Simplify Verikora, krizaka/verikora#120).
 * Every one answers 308: with the language prefix, and without it. next.config.mjs reads `redirectRules()`;
 * lib/menu.test.ts checks them. A removed page never comes back: change the home instead.
 */

/** The audience landings of the old site, by language: the product is one, so they lead to the home. */
export const OLD_AUDIENCE_SLUGS = [
  "tenant",
  "landlord",
  "freelancer",
  "business",
  "locataire",
  "proprietaire",
  "travailleur-autonome",
  "entreprise",
];

/** Old path (after the language) -> the section or page of the new site it went to. */
const MOVED = {
  "/run": "#proof",
  "/changelog": "",
  "/changelog/feed.xml": "",
  ...Object.fromEntries(OLD_AUDIENCE_SLUGS.map((s) => [`/${s}`, ""])),
};

/**
 * Public pages that moved or are parked (verikora#389). Old path -> new path, both after the language.
 * `/verify` (the report checker, members only) is now a page of the signed-in space.
 */
const MOVED_PAGES = { "/verify": "/app/verifications/report" };

/**
 * Addresses of the signed-in space that were in French (verikora#389): one language for addresses, English, the language of
 * the code. Most specific first. `:path*` carries the rest of the address, the query string always travels with it.
 * `sans-collection` was a page that redirected to the account's default collection (a 307): the library home (`/app`) lists the collections.
 */
const RENAMED_APP = [
  ["/app/recherche", "/app/search"],
  ["/app/bienvenue", "/app/welcome"],
  ["/app/verifier/lots/:path*", "/app/check/batches/:path*"],
  ["/app/verifier", "/app/check"],
  ["/app/bibliotheque/sans-collection", "/app"],
  ["/app/bibliotheque/:path+", "/app/library/:path+"],
  ["/app/bibliotheque", "/app"],
];

/**
 * `/download` is parked while it has nothing to show: no app to download and no video of one. It then answers 308 to the home and is out
 * of the footer and the sitemap. It comes back with the first store link (lib/downloads.ts) or the first video recorded by the e2e tests
 * (content/app-videos.json, krizaka/.github#315); lib/menu.test.ts keeps this list, `downloadPageOpen` and the manifest in step.
 */
const hasVideos = (() => {
  try {
    return (
      (JSON.parse(readFileSync(new URL("../content/app-videos.json", import.meta.url), "utf8")).videos ?? []).length > 0
    );
  } catch {
    return false;
  }
})();
export const PARKED_PAGES = hasVideos ? [] : ["/download"];

/**
 * Short addresses that are served by a route of the API, not removed pages: the public check of a sealed contract
 * (`/verify/contract/<sha256>`, verikora#71) answers 308 to its route.
 * @type {RemovedRule[]}
 */
export const ALIAS_RULES = [
  { source: "/verify/contract/:sha256([0-9a-f]{64})", destination: "/api/verify/contract/:sha256", permanent: true },
];

/** @returns {RemovedRule[]} */
export function redirectRules() {
  const rules = [];
  for (const path of PARKED_PAGES) {
    for (const locale of ["en", "fr"])
      rules.push({ source: `/${locale}${path}`, destination: `/${locale}`, permanent: true });
    rules.push({ source: path, destination: "/", permanent: true });
  }
  for (const [from, to] of [...Object.entries(MOVED_PAGES), ...RENAMED_APP]) {
    for (const locale of ["en", "fr"])
      rules.push({ source: `/${locale}${from}`, destination: `/${locale}${to}`, permanent: true });
    rules.push({ source: from, destination: to, permanent: true });
  }
  for (const [path, to] of Object.entries(MOVED)) {
    for (const locale of ["en", "fr"])
      rules.push({ source: `/${locale}${path}`, destination: `/${locale}${to}`, permanent: true });
    // No language in the address: the home chooses the visitor's language itself.
    rules.push({ source: path, destination: `/${to}`, permanent: true });
  }
  return rules;
}
