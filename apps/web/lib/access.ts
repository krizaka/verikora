import {
  ADMIN_REFUSAL,
  ipAllowed as listed,
  requireAdmin as adminGate,
  sessionTokenOf as tokenOf,
} from "@krizaka/auth";
import { cookies, headers } from "next/headers";

import { clientAddress } from "./client-address";
import { consoleAllowedIps } from "./env";
import { isAdminHost } from "./host";
import { refuse } from "./http";
import { resolveSession, type Session, SESSION_COOKIE } from "./session";
import { assertOpen } from "./settings/guards";

/**
 * Who may do what (`@krizaka/auth`'s locks). Pages and API share the rules: a session for the library; for the administration three
 * locks — a session, the ADMIN role, and an address of AUTH_ALLOWED_IPS (empty in production = nobody). A failed lock answers 404
 * on pages (the administration does not announce itself) and 403 on the API.
 */
export function consoleIpAllowed(
  requestHeaders: Headers,
  source: Record<string, string | undefined> = process.env,
): boolean {
  return listed(clientAddress(requestHeaders, source), consoleAllowedIps(source));
}

/** admin.verikora.com answers only addresses of AUTH_ALLOWED_IPS, its sign-in page and sign-in call included; the product host is open. */
export function hostAllowed(
  requestHeaders: Headers,
  source: Record<string, string | undefined> = process.env,
): boolean {
  return !isAdminHost(requestHeaders.get("host")) || consoleIpAllowed(requestHeaders, source);
}

/** The session token of a request: the native apps' `Authorization: Bearer` (which wins), else the web's cookie. */
export const requestSessionToken = (requestHeaders: Headers): string | undefined =>
  tokenOf(requestHeaders, { cookie: SESSION_COOKIE });

/** The API's caller, from the bearer or the session cookie — or 401. */
export async function requireSession(req: Request): Promise<Session> {
  const session = await resolveSession(requestSessionToken(req.headers));
  if (!session) throw refuse(401, "UNAUTHENTICATED", "Sign in first");
  await assertOpen(session.account);
  return session;
}

const REFUSALS: Record<string, string> = {
  [ADMIN_REFUSAL.unauthenticated]: "Sign in first",
  [ADMIN_REFUSAL.forbidden]: "Administrators only",
  [ADMIN_REFUSAL.ipNotAllowed]: "This address may not use the administration",
  [ADMIN_REFUSAL.notFound]: "Not found",
};

// lib-allow: Verikora binds `adminGate` of @krizaka/auth to its own session, its API refusals and the allowed addresses
export async function requireAdmin(req: Request): Promise<Session> {
  const session = await requireSession(req);
  const decision = adminGate({
    session,
    ip: clientAddress(req.headers),
    allowedIps: consoleAllowedIps(),
    surface: "api",
  });
  if (!decision.ok) throw refuse(decision.status, decision.code, REFUSALS[decision.code] ?? "Refused");
  return session;
}

/** The session of the page being rendered (a Server Component), or null. */
export async function pageSession(): Promise<Session | null> {
  return resolveSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The page's administrator — session, role and address — or null (the page answers 404). */
export async function pageAdmin(): Promise<Session | null> {
  const session = await pageSession();
  return adminGate({ session, ip: clientAddress(await headers()), allowedIps: consoleAllowedIps(), surface: "page" }).ok
    ? session
    : null;
}
