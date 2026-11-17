import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PUBLIC_TARGET } from "./lib/public-build/routes.mjs";

/**
 * The public export (krizaka-internal#4148): `scripts/build-public.mjs` stages a project that links the page files of
 * `lib/public-build/routes.mjs` and this file as its `next.config.mjs`, then runs `next build` there. A static export has no
 * server, no proxy and no API: the pages are rendered once, here, and the result is plain files.
 */
const packageVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const appVersion = process.env.APP_VERSION?.trim() || packageVersion;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // Each page is a folder with an index.html: any static host serves /fr/docs without a rewrite rule.
  trailingSlash: true,
  // The monorepo root: the linked files resolve outside the staged folder.
  // Modules that differ wholesale from the dev app are swapped here and nowhere else: the bar's session island (no sign-in, no API call),
  // the dictionary the browser receives, and the pricing data (the catalogue's seed, no database, no session).
  turbopack: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    resolveAlias: {
      "@/components/BarSession": "./components/public-build/BarSession.tsx",
      // The bar is a client component: in the browser it gets its own words only, not every catalogue of the app.
      "@/lib/i18n": { browser: "./lib/public-build/chrome-i18n.ts" },
      "@/lib/prices/pricing-page-view": "./lib/prices/pricing-page-view.public.ts",
    },
  },
  transpilePackages: ["@verikora/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_APP_VERSION: appVersion, NEXT_PUBLIC_BUILD_TARGET: PUBLIC_TARGET },
};

export default nextConfig;
