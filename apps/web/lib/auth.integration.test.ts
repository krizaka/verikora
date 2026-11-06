import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({
  set: [] as { name: string; value: string; httpOnly: boolean; sameSite: string; path: string; expires: Date }[],
  deleted: [] as string[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (cookie: (typeof jar.set)[number]) => void jar.set.push(cookie),
    delete: (name: string) => void jar.deleted.push(name),
  }),
  headers: async () => new Headers(),
}));

import { hashPassword } from "@krizaka/auth";

import { POST as signIn } from "@/app/api/auth/sign-in/route";
import { POST as signOut } from "@/app/api/auth/sign-out/route";
import { GET as me } from "@/app/api/me/route";

import { requireAdmin, requireSession, sessionTokenOf } from "./access";
import { migrate, pool, query } from "./db";
import { resetRateLimits } from "./limits";
import { resolveSession, SESSION_COOKIE } from "./session";
import { appSettings, resetAppSettings } from "./settings/instance";
import { GLOBAL } from "./settings/service";

/**
 * Sign-in, session, sign-out, expiry, the administration's locks and the 429, through the real routes and PostgreSQL
 * (CI's service; locally DATABASE_IT=1 DATABASE_URL=…). verikora#263: the paths `@krizaka/auth` now serves.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

const PASSWORD = "correct horse battery staple";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.40", ...headers },
    body: JSON.stringify(body),
  });
const as = (token: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/anything", { headers: { cookie: `${SESSION_COOKIE}=${token}`, ...headers } });
const refusalOf = async (run: Promise<unknown>) => {
  try {
    await run;
    return null;
  } catch (error) {
    return error as { status: number; body: { code: string } };
  }
};

describe.runIf(enabled)("sign-in, sessions and the administration's locks", () => {
  const stamp = Date.now();
  const emailOf = (who: string) => `auth-${who}-${stamp}@verikora.test`;
  const ids: Record<string, string> = {};

  const account = async (who: string, extra = "") => {
    const [row] = await query<{ id: string }>(
      `INSERT INTO accounts (email, password_hash, email_verified_at, ${extra ? `${extra.split("=")[0]},` : ""} locale) VALUES ($1, $2, now(), ${extra ? `${extra.split("=")[1]},` : ""} 'en') RETURNING id`,
      [emailOf(who), await hashPassword(PASSWORD)],
    );
    ids[who] = row!.id;
  };

  beforeAll(async () => {
    await migrate();
    await account("user");
    await account("admin", "role='ADMIN'");
    await account("suspended", "status='SUSPENDED'");
  });
  afterAll(async () => {
    await appSettings().reset({ id: null, label: "test" }, GLOBAL, "auth.sessionDays", new Date());
    await query("DELETE FROM accounts WHERE email LIKE $1", [`auth-%-${stamp}@verikora.test`]);
    await pool().end();
  });
  beforeEach(() => {
    resetRateLimits();
    jar.set = [];
    jar.deleted = [];
    vi.unstubAllEnvs();
  });

  const login = async (who: string, password = PASSWORD, headers: Record<string, string> = {}) =>
    signIn(post("/api/auth/sign-in", { email: emailOf(who), password }, headers));

  it("login: the right password opens a session — an HttpOnly, SameSite=Lax cookie holding a ys1 token, kept only as a keyed hash", async () => {
    const res = await login("user");
    expect(res.status).toBe(200);
    const cookie = jar.set[0]!;
    expect(cookie).toMatchObject({ name: SESSION_COOKIE, httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookie.value).toMatch(/^ys1\.[A-Za-z0-9_-]{43}$/);
    const stored = await query<{ token_hash: string; ip: string | null }>(
      "SELECT token_hash, ip FROM sessions WHERE account_id = $1",
      [ids.user],
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((s) => !s.token_hash.includes(cookie.value) && /^[0-9a-f]{64}$/.test(s.token_hash))).toBe(true);
    expect(stored.at(-1)?.ip).toBe("203.0.113.40");
    expect((await resolveSession(cookie.value))?.account.email).toBe(emailOf("user"));
    // the session lasts the setting's days (14 by default)
    const [{ days }] = await query<{ days: number }>(
      "SELECT round(extract(epoch FROM (max(expires_at) - now())) / 86400)::int AS days FROM sessions WHERE account_id = $1",
      [ids.user],
    );
    expect(days).toBe(14);
  });

  it("login: a native client gets the token for a bearer, no cookie", async () => {
    const res = await signIn(
      post("/api/auth/sign-in", { email: emailOf("user"), password: PASSWORD, client: "native" }),
    );
    const body = await res.json();
    expect(jar.set).toEqual([]);
    expect((await resolveSession(body.token))?.account.id).toBe(ids.user);
    expect(
      (await requireSession(new Request("http://localhost/x", { headers: { authorization: `Bearer ${body.token}` } })))
        .account.id,
    ).toBe(ids.user);
  });

  it("login: a wrong password and an unknown address get the same 401; a suspended account is refused only with the right password", async () => {
    const wrong = await login("user", "not the password at all");
    const unknown = await signIn(
      post("/api/auth/sign-in", { email: `nobody-${stamp}@verikora.test`, password: PASSWORD }),
    );
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect((await login("suspended", "not the password at all")).status).toBe(401);
    expect((await login("suspended")).status).toBe(403);
    expect(jar.set).toEqual([]);
  });

  it("login: the 429 — the 11th try for one address, with its code and Retry-After; another address still passes", async () => {
    for (let i = 0; i < 10; i += 1) expect((await login("user", "wrong password again")).status).toBe(401);
    const limited = await login("user", "wrong password again");
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    // the right password does not get through a limit that is reached
    expect((await login("user")).status).toBe(429);
    expect((await login("admin")).status).toBe(200);
  });

  it("logout: the session ends at once, the cookie is dropped, and a second logout is harmless", async () => {
    await login("user");
    const token = jar.set.at(-1)!.value;
    expect(await resolveSession(token)).not.toBeNull();
    expect((await signOut(as(token))).status).toBe(204);
    expect(jar.deleted).toContain(SESSION_COOKIE);
    expect(await resolveSession(token)).toBeNull();
    expect(await refusalOf(requireSession(as(token)))).toMatchObject({
      status: 401,
      body: { code: "UNAUTHENTICATED" },
    });
    expect((await signOut(as(token))).status).toBe(204);
  });

  it("expiry: a session past its date resolves to nobody, in every door", async () => {
    await login("user");
    const token = jar.set.at(-1)!.value;
    await query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE account_id = $1", [ids.user]);
    expect(await resolveSession(token)).toBeNull();
    expect(await refusalOf(requireSession(as(token)))).toMatchObject({ status: 401 });
    expect(await (await me(as(token))).json()).toMatchObject({ signedIn: false });
  });

  it("session length is the administrator's setting (auth.sessionDays), read for each new session", async () => {
    resetAppSettings();
    await appSettings().set({ id: null, label: "test" }, GLOBAL, "auth.sessionDays", 3, new Date());
    await login("admin");
    const [{ days }] = await query<{ days: number }>(
      "SELECT round(extract(epoch FROM (expires_at - now())) / 86400)::int AS days FROM sessions WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1",
      [ids.admin],
    );
    expect(days).toBe(3);
  });

  it("a suspension applies on the next request, even to a live session", async () => {
    await login("user");
    const token = jar.set.at(-1)!.value;
    await query("UPDATE accounts SET status = 'SUSPENDED' WHERE id = $1", [ids.user]);
    expect(await resolveSession(token)).toBeNull();
    await query("UPDATE accounts SET status = 'ACTIVE' WHERE id = $1", [ids.user]);
    expect(await resolveSession(token)).not.toBeNull();
  });

  it("GET /api/me follows the family's contract: signed in → { signedIn: true, account }, with the headers", async () => {
    await login("user");
    const res = await me(as(jar.set.at(-1)!.value));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ signedIn: true, account: { id: ids.user, email: emailOf("user") } });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Vary")).toContain("Cookie");
  });

  it("admin gate: no session 401, a member 403 FORBIDDEN, an administrator off the list 403 IP_NOT_ALLOWED, on the list in", async () => {
    vi.stubEnv("AUTH_ALLOWED_IPS", "203.0.113.50");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SESSION_SECRET", "t".repeat(40));
    vi.stubEnv("ABUSE_CLIENT_IP_HEADER", "do-connecting-ip");
    const userToken = (
      await (
        await signIn(post("/api/auth/sign-in", { email: emailOf("user"), password: PASSWORD, client: "native" }))
      ).json()
    ).token as string;
    const adminToken = (
      await (
        await signIn(post("/api/auth/sign-in", { email: emailOf("admin"), password: PASSWORD, client: "native" }))
      ).json()
    ).token as string;
    const from = (token: string | null, ip: string) =>
      new Request("http://localhost/api/admin/x", {
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "do-connecting-ip": ip },
      });
    expect(await refusalOf(requireAdmin(from(null, "203.0.113.50")))).toMatchObject({
      status: 401,
      body: { code: "UNAUTHENTICATED" },
    });
    expect(await refusalOf(requireAdmin(from(userToken, "203.0.113.50")))).toMatchObject({
      status: 403,
      body: { code: "FORBIDDEN" },
    });
    expect(await refusalOf(requireAdmin(from(adminToken, "198.51.100.9")))).toMatchObject({
      status: 403,
      body: { code: "IP_NOT_ALLOWED" },
    });
    expect((await requireAdmin(from(adminToken, "203.0.113.50"))).account.role).toBe("ADMIN");
    // an empty list in production is nobody
    vi.stubEnv("AUTH_ALLOWED_IPS", "");
    expect(await refusalOf(requireAdmin(from(adminToken, "203.0.113.50")))).toMatchObject({
      status: 403,
      body: { code: "IP_NOT_ALLOWED" },
    });
    expect(sessionTokenOf(new Headers({ authorization: `Bearer ${adminToken}` }))).toBe(adminToken);
  });
});
