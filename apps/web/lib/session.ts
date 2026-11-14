import { createSessions, dbSessionStore, memorySessionStore, sessionCookie as cookieOf } from "@krizaka/auth";
import type { Audience } from "@verikora/core";

import { systemClock } from "../app/system-clock";
import { query } from "./db";
import { sessionSecret } from "./env";
import { SESSION_COOKIE } from "./session-cookie";
import { appSettings } from "./settings/instance";

/**
 * Web sessions (`@krizaka/auth`). The cookie holds a random token (`ys1.` + 32 bytes); the table keeps only its keyed hash, so a leaked
 * table opens nothing. The account is re-read on every request (a suspension applies at once). The length is the setting
 * `auth.sessionDays` (14 by default); HttpOnly, Secure in production, SameSite=Lax. The tokens and hashes already stored keep working.
 */
export { SESSION_COOKIE };

export interface SessionAccount {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  locale: "en" | "fr";
  perspective: Audience | null;
  territory: string;
  name: string | null;
  avatarSeed: string | null;
}

export interface Session {
  id: string;
  account: SessionAccount;
}

const sessions = createSessions<SessionAccount>({
  store: dbSessionStore(query, {
    columns: ["id", "email", "role", "locale", "perspective", "territory", "name", "avatar_seed"],
    toAccount: (row) => ({
      id: String(row.id),
      email: String(row.email),
      role: row.role as SessionAccount["role"],
      locale: row.locale as SessionAccount["locale"],
      perspective: (row.perspective as Audience | null) ?? null,
      territory: String(row.territory),
      name: (row.name as string | null) ?? null,
      avatarSeed: (row.avatar_seed as string | null) ?? null,
    }),
    active: { column: "status", equals: "ACTIVE" },
  }),
  clock: systemClock,
  tokenPrefix: "ys",
  secret: sessionSecret,
  sessionDays: async () => (await appSettings().get("auth.sessionDays")) as number,
});

export const newToken = sessions.newToken;
export const isToken = sessions.isToken;

/** The keyed hash of a token (`HMAC-SHA256("session:" + secret)`): also what the mailed links keep instead of their token. */
export const tokenHash = (token: string, secret = sessionSecret()) =>
  createSessions({
    store: memorySessionStore(() => null),
    clock: systemClock,
    tokenPrefix: "ys",
    secret,
    sessionDays: 1,
  }).tokenHash(token);

export const createSession = sessions.create;
export const resolveSession = sessions.resolve;
export const revokeSession = sessions.revoke;

export const verikoraSessionCookie = (token: string, expires: Date) =>
  cookieOf(token, expires, { name: SESSION_COOKIE, secure: process.env.NODE_ENV === "production" });
