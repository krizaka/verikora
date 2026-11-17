import { join } from "node:path";

/**
 * The public export of Verikora (krizaka-internal#4148): the pages a visitor may read on www.verikora.com while the product has no
 * accounts there. One list, read by the build script (which stages exactly these page files), the export check and its test.
 * A page is added here AND reviewed for server parts: nothing else is ever exported.
 */
export const PUBLIC_LOCALES = ["fr", "en"];

/** The page folders under `app/[locale]/` that are exported ("" is the home). */
export const PUBLIC_PAGES = ["", "docs", "pricing", "contact", "privacy"];

/** The routes the export holds, as the check reads them in the output folder (`/fr`, `/fr/docs`, …). */
export const PUBLIC_ROUTES = PUBLIC_LOCALES.flatMap((locale) =>
  PUBLIC_PAGES.map((page) => (page ? `/${locale}/${page}` : `/${locale}`)),
);

/** Files of `app/` the staged project needs besides the page files (styles, icons): never a route of their own. */
export const PUBLIC_APP_ASSETS = ["globals.css", "icon.svg", "apple-icon.png"];

/** What the staged project links to, unchanged, from `apps/web`: the code the pages import. */
export const PUBLIC_SHARED_ENTRIES = ["components", "lib", "messages", "content", "package.json", "postcss.config.mjs"];

/** The target the staged build is made for (read at build time by lib/build-target.ts). */
export const PUBLIC_TARGET = "public";

/** The files of `app/` the staged project links, relative to it: the locale layout, the page of each exported folder, the assets. */
export const stagedAppFiles = () => [
  ...PUBLIC_APP_ASSETS,
  join("[locale]", "layout.tsx"),
  ...PUBLIC_PAGES.map((page) => join("[locale]", page, "page.tsx")),
];
