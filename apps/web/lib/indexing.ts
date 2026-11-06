/**
 * One flag decides whether this deployment is open to search engines: `APP_SEARCH_INDEXING=off` closes it — robots.txt `Disallow: /` with no sitemap, `X-Robots-Tag: noindex, nofollow, noarchive` on every
 * response, `<meta name="robots">` noindex, and the « development environment » line in the footer. Production flips it by
 * configuration alone. Read at request time (the proxy) — never baked at build.
 */
export const NOINDEX_HEADER = "noindex, nofollow, noarchive";

export const indexable = (env: Record<string, string | undefined> = process.env): boolean =>
  env.APP_SEARCH_INDEXING?.trim().toLowerCase() !== "off";

/** robots.txt of a deployment that is not indexed: closed, and no sitemap to advertise. */
export const CLOSED_ROBOTS = "User-agent: *\nDisallow: /\n";

/* --- Two addresses, one app (epic krizaka/.github#119, krizaka-com AGENTS section 2.4) ---
   www.<product>.com (APP_PUBLIC_URL) is the public face and is indexed. dev.<product>.com (APP_DEV_HOST) is the
   development address: nothing of it is indexed, every HTML page goes to www with a 308, and only what is called
   keeps serving there (the API, auth callbacks, webhooks, /.well-known, /healthz) - with noindex. APP_SEARCH_INDEXING=off
   keeps its other meanings (the development notice, the non-licensed sources); it no longer closes the public host. */
const bare = (host: string | null | undefined) => (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
export const publicHost = (env: Record<string, string | undefined> = process.env): string => {
  try {
    return bare(new URL(env.APP_PUBLIC_URL ?? "https://www.yomizaka.com").host);
  } catch {
    return "";
  }
};
/** A `dev.*` address is never indexed (krizaka/yomizaka#239), whatever the flag and whether or not APP_DEV_HOST names it. */
const isDevName = (host: string | null | undefined) => bare(host).startsWith("dev.");
/**
 * A code-name address (`www.yomizaka.com`, `dev.yomizaka.com`) is never indexed (meeting of 2026-11-05, wave 1): the product's public
 * address is its commercial domain (`www.verikora.com`), the one search engines get. Same for the apex and any other `*.yomizaka.com`.
 */
export const isCodeNameHost = (host: string | null | undefined): boolean => /(^|\.)yomizaka\.com$/.test(bare(host));
/** Whether a response to this host may be indexed. */
export const indexableOn = (
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean => !isDevName(host) && !isCodeNameHost(host) && (indexable(env) || bare(host) === publicHost(env));

/** `<meta name="robots">` of the pages: noindex when the site's own address is not indexable (see `indexableOn`), nothing otherwise. */
export const metaRobots = (
  siteUrl: string,
  env: Record<string, string | undefined> = process.env,
): { index: false; follow: false } | undefined =>
  indexableOn(new URL(siteUrl).host, env) ? undefined : { index: false, follow: false };
export const isDevHost = (
  host: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean => !!env.APP_DEV_HOST?.trim() && bare(host) === bare(env.APP_DEV_HOST);

/** What the dev host keeps serving: robots.txt, /healthz, the API (auth callbacks, webhooks, the mobile apps' calls) and /.well-known. */
const DEV_KEEPS = ["/api/", "/.well-known/"];
const DEV_KEEPS_EXACT = new Set(["/robots.txt", "/healthz"]);
/** The www address a dev-host request goes to (308), or null when the dev host keeps serving it. Only GET and HEAD are pages. */
export function devRedirect(method: string, pathname: string, search: string, publicUrl: string): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (DEV_KEEPS_EXACT.has(pathname) || DEV_KEEPS.some((p) => pathname.startsWith(p))) return null;
  return `${publicUrl.replace(/\/$/, "")}${pathname}${search}`;
}
