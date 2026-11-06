/**
 * Two sites, one app: dev.verikora.com (the product) and admin.verikora.com (the administration console). The proxy
 * decides by the host: on the admin host every page is the console (`/en/users` is served by `/en/console/users`) and
 * nothing else; on the product host the console does not exist (404). Pure, so it is tested without a server.
 */
export const isAdminHost = (host: string | null | undefined) => /^admin\./i.test(host ?? "");

export type HostRoute =
  | { kind: "next" }
  | { kind: "rewrite"; path: string }
  | { kind: "redirect"; path: string }
  | { kind: "notFound" }
  | { kind: "robotsClosed" };

const LOCALE = /^\/(en|fr)(?=\/|$)/;

const isConsolePath = (rest: string) => rest === "/console" || rest.startsWith("/console/");
const isMachineFile = (pathname: string) =>
  pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/llms.txt";
/** An address without a language goes to the visitor's choice. */
const toLocale = (pathname: string, preferred: "en" | "fr"): HostRoute => ({
  kind: "redirect",
  path: `/${preferred}${pathname === "/" ? "" : pathname}`,
});

/** admin.*: every page is the console (`/en/users` is served by `/en/console/users`), nothing else. */
function adminRoute(pathname: string, locale: string | undefined, preferred: "en" | "fr"): HostRoute {
  if (pathname === "/robots.txt") return { kind: "robotsClosed" };
  if (pathname === "/sitemap.xml" || pathname === "/llms.txt") return { kind: "notFound" };
  if (!locale) return toLocale(pathname, preferred);
  const rest = pathname.slice(locale.length + 1);
  if (isConsolePath(rest)) return { kind: "redirect", path: `/${locale}${rest.slice("/console".length)}` };
  return { kind: "rewrite", path: `/${locale}/console${rest}` };
}

/** The product host: the console does not exist there. */
function productRoute(pathname: string, locale: string | undefined, preferred: "en" | "fr"): HostRoute {
  if (isMachineFile(pathname)) return { kind: "next" };
  if (!locale) return toLocale(pathname, preferred);
  return isConsolePath(pathname.slice(locale.length + 1)) ? { kind: "notFound" } : { kind: "next" };
}

export function routeFor(host: string | null | undefined, pathname: string, preferred: "en" | "fr"): HostRoute {
  const locale = LOCALE.exec(pathname)?.[1];
  return isAdminHost(host) ? adminRoute(pathname, locale, preferred) : productRoute(pathname, locale, preferred);
}
