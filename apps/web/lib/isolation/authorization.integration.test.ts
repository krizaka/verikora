import crypto from "node:crypto";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as createKeyRoute } from "@/app/api/me/api-keys/route";

import { migrate, pool, query } from "../db";
import { seedDatabase } from "../flows";
import { resetRateLimits } from "../limits";
import { createSession, SESSION_COOKIE } from "../session";
import {
  ACCESS,
  type Access,
  API_SCOPES,
  type ApiScope,
  AUTHORIZATION,
  type Caller,
  CALLERS,
  type Expected,
  expectedFor,
  GATE_CODES,
} from "./authorization";
import { APP, type RouteKey } from "./routes";

// sign-out deletes its cookie through `next/headers`, which only a Next request scope provides
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

/**
 * The authorization matrix on PostgreSQL (krizaka-internal#2382; CI's service, locally `DATABASE_IT=1 DATABASE_URL=… pnpm test`).
 * Every row of `authorization.ts` is called as each caller — no session, a member, an administrator (from an allowed address and from
 * a foreign one), an API key with the row's scope and one without it — and the answer must be what the row says: the gate's refusal
 * (its status and code), or an answer that carries no gate's code. Each call has its own session, so a handler that ends a session
 * (sign-out) never changes the next call.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const ALLOWED_IP = "203.0.113.82";
const FOREIGN_IP = "198.51.100.82";
const IP_HEADER = "do-connecting-ip";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Answer {
  status: number;
  code: string | null;
}

/** A value for each `[segment]` of the path: the routes' own vocabularies where they have one, a fresh id elsewhere. */
const VALUES: Record<string, string> = { kind: "applicant_file", cloud: "dropbox" };

const codeOf = (text: string): string | null => {
  try {
    const code = (JSON.parse(text) as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
};

/** What the answer says of the gate: its refusal, or that it let the caller in. */
const verdict = (answer: Answer): Expected =>
  (GATE_CODES as readonly string[]).includes(answer.code ?? "")
    ? ({ status: answer.status, code: answer.code } as Expected)
    : { passes: true };

describe.runIf(enabled)("authorization matrix: each caller gets what its row says (krizaka-internal#2382)", () => {
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const accounts: Record<"member" | "admin", string> = { member: "", admin: "" };
  /** a key holding every scope, and per scope a key holding only it and one holding all the others */
  let everyScope = "";
  const only = {} as Record<ApiScope, string>;
  const allBut = {} as Record<ApiScope, string>;

  const account = async (role: "USER" | "ADMIN", label: string) => {
    const [row] = await query<{ id: string }>(
      `INSERT INTO accounts (email, role, password_hash, plan, subscription_status, current_period_end, terms_accepted_at, email_verified_at)
       VALUES ($1, $2, 'x', 'PRO', 'active', now() + interval '30 days', now(), now()) RETURNING id`,
      [`authz-${label}-${stamp}@verikora.test`, role],
    );
    return row!.id;
  };
  const session = async (accountId: string) =>
    (await createSession(accountId, { ip: ALLOWED_IP, userAgent: "vitest" })).token;
  const mint = async (owner: string, scopes: readonly ApiScope[]) => {
    const res = await createKeyRoute(
      new Request("http://localhost/api/me/api-keys", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${await session(owner)}`, "content-type": "application/json" },
        body: JSON.stringify({ name: `Matrice ${scopes.join(" ")}`, scopes, expiresInDays: 30 }),
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { key: string }).key;
  };

  beforeAll(async () => {
    vi.stubEnv("AUTH_ALLOWED_IPS", ALLOWED_IP);
    vi.stubEnv("ABUSE_CLIENT_IP_HEADER", IP_HEADER);
    await migrate();
    await seedDatabase();
    accounts.member = await account("USER", "member");
    accounts.admin = await account("ADMIN", "admin");
    everyScope = await mint(accounts.member, API_SCOPES);
    for (const scope of API_SCOPES) {
      // each key's own owner: a plan caps the keys one account holds
      const owner = await account("USER", scope.replace(":", "-"));
      only[scope] = await mint(owner, [scope]);
      allBut[scope] = await mint(
        owner,
        API_SCOPES.filter((s) => s !== scope),
      );
    }
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await query("DELETE FROM accounts WHERE email LIKE $1", [`authz-%-${stamp}@verikora.test`]);
    await pool().end();
  });

  /** The headers a caller sends to a row. */
  const headersOf = async (caller: Caller, row: Access): Promise<Record<string, string>> => {
    const scope = row.access === ACCESS.apiKey ? row.scope : null;
    switch (caller) {
      case CALLERS.anonymous:
        return { [IP_HEADER]: ALLOWED_IP };
      case CALLERS.member:
        return { [IP_HEADER]: ALLOWED_IP, cookie: `${SESSION_COOKIE}=${await session(accounts.member)}` };
      case CALLERS.admin:
        return { [IP_HEADER]: ALLOWED_IP, cookie: `${SESSION_COOKIE}=${await session(accounts.admin)}` };
      case CALLERS.adminElsewhere:
        return { [IP_HEADER]: FOREIGN_IP, cookie: `${SESSION_COOKIE}=${await session(accounts.admin)}` };
      case CALLERS.apiKey:
        return { [IP_HEADER]: ALLOWED_IP, authorization: `Bearer ${scope ? only[scope] : everyScope}` };
      case CALLERS.apiKeyWithoutScope:
        return { [IP_HEADER]: ALLOWED_IP, authorization: `Bearer ${scope ? allBut[scope] : everyScope}` };
    }
  };

  /** One call to a route handler as a caller: an empty JSON body on a write, a value in each segment of the path. */
  const call = async (key: RouteKey, caller: Caller, row: Access): Promise<Answer> => {
    resetRateLimits();
    const [method, route] = key.split(" ") as [string, string];
    const handler = ((await import(path.join(APP, route, "route.ts"))) as Record<string, Handler>)[method];
    if (!handler) throw new Error(`${key}: no such handler`);
    const params: Record<string, string> = {};
    const concrete = route.replace(
      /\[(\w+)\]/g,
      (_, name: string) => (params[name] = VALUES[name] ?? crypto.randomUUID()),
    );
    const headers = await headersOf(caller, row);
    const write = method !== "GET";
    if (write) headers["content-type"] = "application/json";
    const res = await handler(
      new Request(`http://localhost${concrete}`, { method, headers, body: write ? "{}" : undefined }),
      { params: Promise.resolve(params) },
    );
    return { status: res.status, code: codeOf(await res.text()) };
  };

  it.each(Object.entries(AUTHORIZATION) as [RouteKey, Access][])("%s", async (key, row) => {
    const seen: Partial<Record<Caller, Expected>> = {};
    const want: Partial<Record<Caller, Expected>> = {};
    for (const caller of Object.values(CALLERS)) {
      seen[caller] = verdict(await call(key, caller, row));
      want[caller] = expectedFor(row, caller);
    }
    expect(seen).toEqual(want);
  });
});
