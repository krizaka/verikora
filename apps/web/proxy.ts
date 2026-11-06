import { landingRedirect, sessionHint } from "@krizaka/auth";
import { type NextRequest, NextResponse } from "next/server";

import { type HostRoute, isAdminHost, routeFor } from "./lib/host";
import { CLOSED_ROBOTS, devRedirect, indexableOn, isDevHost, NOINDEX_HEADER } from "./lib/indexing";
import { SESSION_COOKIE } from "./lib/session-cookie";
import { SITE_URL } from "./lib/site";

/**
 * Every page exists in French and English (`/fr/…`, `/en/…`); an address without a language goes to the visitor's choice
 * (cookie `NEXT_LOCALE`), else French (Loi 96, verikora#366): English is a choice, never the default. admin.verikora.com serves only the administration console (lib/host.ts), never
 * indexed; dev.verikora.com never serves it. A deployment with APP_SEARCH_INDEXING=off (lib/indexing.ts) answers noindex on
 * every response — pages, redirects and the API — and a closed robots.txt without a sitemap.
 */
const isLocale = (value: string | undefined): value is "en" | "fr" => value === "en" || value === "fr";
const closedRobots = () => new NextResponse(CLOSED_ROBOTS, { headers: { "content-type": "text/plain" } });
const notFound = () => new NextResponse("Not found", { status: 404 });
/** krizaka-ui#827: a signed-in person never sees the public landing page; the cookie is a hint, the app and the API still resolve the session. */
const LANDING = ["/", "/fr", "/en"] as const;
const hinted = <T extends NextResponse>(response: T, request: NextRequest): T =>
  sessionHint(response, request, { cookie: SESSION_COOKIE, secure: process.env.NODE_ENV === "production" });
const seal = <T extends Response>(response: T, closed: boolean): T => {
  if (closed) response.headers.set("x-robots-tag", NOINDEX_HEADER);
  return response;
};

/** dev.verikora.com (APP_DEV_HOST): robots.txt closes everything; a page goes to www (308); healthz keeps serving. */
function devResponse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname === "/robots.txt") return closedRobots();
  const to = devRedirect(
    request.method,
    request.nextUrl.pathname,
    request.nextUrl.search,
    process.env.APP_PUBLIC_URL ?? SITE_URL,
  );
  return to ? NextResponse.redirect(to, 308) : NextResponse.next();
}

/** The answers that need no page: a closed robots.txt, a 404, a redirect to the public host (admin.verikora.com stays admin.verikora.com). */
function directResponse(request: NextRequest, route: HostRoute, host: string | null): NextResponse | null {
  switch (route.kind) {
    case "robotsClosed":
      return closedRobots();
    case "notFound":
      return notFound();
    case "redirect": {
      const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
      return NextResponse.redirect(new URL(route.path, host ? `${proto}://${host}` : request.url));
    }
    default:
      return null;
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  const chosen = request.cookies.get("NEXT_LOCALE")?.value === "en" ? "en" : "fr";
  const admin = isAdminHost(host);
  const dev = isDevHost(host);
  // Closed to search engines: the consoles and the dev host always; every other host but the public one (APP_PUBLIC_URL's:
  // www.verikora.com) when APP_SEARCH_INDEXING=off.
  const closed = admin || dev || !indexableOn(host);
  const pathname = request.nextUrl.pathname;
  // The API (and /.well-known) is not routed by language or host: it only carries the noindex header.
  if (pathname.startsWith("/api/") || pathname.startsWith("/.well-known/")) return seal(NextResponse.next(), closed);
  if (dev) return seal(devResponse(request), closed);
  if (!admin && closed && pathname === "/robots.txt") return seal(closedRobots(), closed);
  if (!admin && closed && pathname === "/sitemap.xml") return seal(notFound(), closed);
  const home = admin
    ? null
    : landingRedirect(request, {
        cookie: SESSION_COOKIE,
        landing: LANDING,
        home: () => `/${isLocale(pathname.split("/")[1]) ? pathname.split("/")[1] : chosen}/app`,
        origin: process.env.APP_PUBLIC_URL ?? SITE_URL,
      });
  if (home) return seal(home, closed);
  const route = routeFor(host, pathname, chosen);
  const direct = directResponse(request, route, host);
  if (direct) return seal(direct, closed);
  // The language of the address, carried to the page as `x-locale`: the 404 (no route, no params) answers in it (the UX review's Y10).
  const segment = pathname.split("/")[1];
  const forwarded = new Headers(request.headers);
  forwarded.set("x-locale", isLocale(segment) ? segment : chosen);
  const response =
    route.kind === "rewrite"
      ? NextResponse.rewrite(new URL(route.path, request.url), { request: { headers: forwarded } })
      : NextResponse.next({ request: { headers: forwarded } });
  if (isLocale(segment) && request.cookies.get("NEXT_LOCALE")?.value !== segment) {
    response.cookies.set("NEXT_LOCALE", segment, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return seal(hinted(response, request), closed);
}

export const config = {
  // Every localised address too, even with a dot in a segment (`/fr/screening/missing.pdf`): its 404 needs the language (Y10).
  matcher: [
    "/api/:path*",
    "/((?!api|_next/static|_next/image|og.png|favicon.ico|icon.svg|.*\\..*).*)",
    "/(en|fr)/:path*",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
    "/.well-known/:path*",
  ],
};
