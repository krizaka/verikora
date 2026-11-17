/**
 * Which build this is (krizaka-internal#4148): the dev app (a server: accounts, API, database) or the public export (static files
 * of the public pages, nothing that can sign in). Read here, once; `next.config.public.mjs` sets it at build time. A module that
 * differs wholesale between the two is swapped by an alias of that config (components/public-build, lib/prices): this flag is for
 * the few one-line differences (the notice, the footer, the docs sections).
 */
export const publicBuild = process.env.NEXT_PUBLIC_BUILD_TARGET === "public";
