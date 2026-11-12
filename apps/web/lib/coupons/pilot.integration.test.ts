import { randomUUID } from "node:crypto";

import { addHours, subHours } from "@krizaka/time";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { POST as signUpRoute } from "@/app/api/auth/sign-up/route";
import { POST as redeemRoute } from "@/app/api/billing/coupon/redeem/route";

import { entitlementOf, reserveAudit } from "../billing";
import { migrate, query, transaction } from "../db";
import { HttpError } from "../http";
import { appSettings } from "../settings/instance";
import { GLOBAL } from "../settings/service";
import { signUp, verifyEmail } from "../signup";
import { coupons } from "./instance";
import { checkPilotCode, PILOT_ALREADY_USED, redeemCreditCode } from "./pilot";

/** The free pilot against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL): krizaka-internal#3230. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date();
const ADMIN = { id: null, label: "admin@verikora.test" };
const audits: { action: string }[] = [];

const session = vi.hoisted(() => ({ accountId: "", email: "", signupOpen: true }));
vi.mock("@/lib/settings/signup", () => ({ signupOpenNow: async () => session.signupOpen }));
vi.mock("@/lib/access", () => ({
  requireSession: async () => ({ account: { id: session.accountId, email: session.email } }),
}));
vi.mock("../audit", async (original) => ({
  ...(await original<typeof import("../audit")>()),
  audit: async (entry: { action: string }) => void audits.push(entry),
}));

describe.runIf(enabled)("the free pilot", () => {
  beforeAll(async () => {
    await migrate();
    await appSettings().set(ADMIN, GLOBAL, "coupons.enabled", true, NOW);
  });
  const account = async () => {
    const [a] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), now()) RETURNING id",
      [`p-${randomUUID()}@verikora.test`],
    );
    return a!.id;
  };
  const code = () => `P${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`;
  const pilot = (over: Record<string, unknown> = {}) =>
    transaction((tx) =>
      coupons.admin.create(tx, ADMIN, {
        code: code(),
        kind: "credit",
        purpose: "demo",
        startsAt: subHours(NOW, 24),
        credits: 3,
        creditsValidDays: 30,
        capPerDay: 3,
        maxRedemptions: 5,
        onExhausted: "stop",
        ...over,
      }),
    );
  const redeem = (c: { code: string }, accountId: string, extra: Record<string, unknown> = {}) =>
    redeemCreditCode({ code: c.code, accountId, idempotencyKey: `t-${randomUUID()}`, ip: ip(), ...extra });
  const refusal = async (work: Promise<unknown>) => {
    const error = await work.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    const e = error as HttpError;
    return { status: e.status, code: e.body.code };
  };

  it("a valid code grants its files, expiring on the code's validity, with no card", async () => {
    const c = await pilot({ credits: 3, creditsValidDays: 14 });
    const id = await account();
    const granted = await redeem(c, id);
    expect(granted.credits).toBe(3);
    expect(granted.expiresAt.getTime()).toBeGreaterThan(addHours(NOW, 312).getTime());
    expect(granted.expiresAt.getTime()).toBeLessThan(addHours(NOW, 360).getTime());
    expect((await entitlementOf(query, id, NOW)).credits).toBe(3);
  });

  it("an unknown code is COUPON_UNKNOWN", async () => {
    const refused = await refusal(redeem({ code: "NOSUCHCODE1" }, await account()));
    expect(refused.code).toBe("COUPON_UNKNOWN");
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it("an expired code is COUPON_EXPIRED", async () => {
    const c = await pilot({ startsAt: subHours(NOW, 240), endsAt: subHours(NOW, 24) });
    expect((await refusal(redeem(c, await account()))).code).toBe("COUPON_EXPIRED");
  });

  it("an exhausted code is COUPON_EXHAUSTED once its cap is reached", async () => {
    const c = await pilot({ maxRedemptions: 1 });
    await redeem(c, await account());
    expect((await refusal(redeem(c, await account()))).code).toBe("COUPON_EXHAUSTED");
  });

  it("the same pilot code twice on one account is PILOT_ALREADY_USED; a repeated promo credit code is the package's COUPON_ACCOUNT_LIMIT", async () => {
    const c = await pilot();
    const id = await account();
    await redeem(c, id);
    expect((await refusal(redeem(c, id))).code).toBe(PILOT_ALREADY_USED);
    const promo = await pilot({ purpose: "promo" });
    await redeem(promo, id);
    expect((await refusal(redeem(promo, id))).code).toBe("COUPON_ACCOUNT_LIMIT");
  });

  it("a second pilot code on the same account is PILOT_ALREADY_USED (409), with an audit line, and grants nothing", async () => {
    const first = await pilot();
    const second = await pilot();
    const id = await account();
    await redeem(first, id);
    audits.length = 0;
    expect(await refusal(redeem(second, id))).toEqual({ status: 409, code: PILOT_ALREADY_USED });
    expect(audits.map((a) => a.action)).toContain("billing.pilot_refused");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(3);
  });

  it("two pilot codes redeemed at once on one account: exactly one is granted (the account's row lock)", async () => {
    const id = await account();
    const [a, b] = [await pilot(), await pilot()];
    const results = await Promise.allSettled([redeem(a, id), redeem(b, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((lost.reason as HttpError).body.code).toBe(PILOT_ALREADY_USED);
    expect((await entitlementOf(query, id, NOW)).credits).toBe(3);
  });

  it("a promo credit code is not a pilot: it does not use the account's pilot", async () => {
    const promo = await pilot({ purpose: "promo" });
    const real = await pilot();
    const id = await account();
    await redeem(promo, id);
    await redeem(real, id);
    expect((await entitlementOf(query, id, NOW)).credits).toBe(6);
  });

  it("the sign-up field takes pilot codes only: a promo code is COUPON_UNKNOWN there", async () => {
    const promo = await pilot({ purpose: "promo" });
    expect((await refusal(checkPilotCode(promo.code, ip()))).code).toBe("COUPON_UNKNOWN");
    const real = await pilot();
    await expect(checkPilotCode(real.code, ip())).resolves.toBeUndefined();
  });

  it("journey: sign up with a pilot code, confirm the address, run one file — taken from the pilot, nothing paid", async () => {
    const c = await pilot({ credits: 2 });
    const email = `j-${randomUUID()}@verikora.test`;
    let link = "";
    await signUp(
      {
        query,
        baseUrl: "https://verikora.test",
        mail: async (m) => void (link = (m as { url: string }).url),
        token: () => `yv1.${randomUUID().replaceAll("-", "").padEnd(43, "A")}`,
      },
      {
        email,
        password: "a-long-enough-password",
        locale: "en",
        acceptTerms: true,
        acceptPrivacy: true,
        pilotCode: c.code,
      },
      NOW,
    );
    const token = new URL(link).searchParams.get("token")!;
    const [row] = await query<{ id: string }>("SELECT id FROM accounts WHERE email = $1", [email]);
    const id = row!.id;
    // no pot before the address is confirmed
    expect((await entitlementOf(query, id, NOW)).credits).toBe(0);
    const verified = await verifyEmail(
      {
        query,
        redeemPilot: async (accountId, typed) => {
          await redeemCreditCode({
            code: typed,
            accountId,
            idempotencyKey: `s-${randomUUID()}`,
            ip: ip(),
            pilotOnly: true,
          });
        },
      },
      token,
      NOW,
    );
    expect(verified).toBe("VERIFIED");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(2);
    const via = await reserveAudit(query, id, NOW, () => ({
      freeDossiers: 0,
      perDay: 0,
      perMonth: 0,
      overageCents: 0,
    }));
    expect(via).toBe("credit");
    expect((await entitlementOf(query, id, NOW)).credits).toBe(1);
  });

  const post = (route: (req: Request) => Promise<Response>, body: unknown) =>
    route(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
  const asAccount = async () => {
    const id = await account();
    const [a] = await query<{ email: string }>("SELECT email FROM accounts WHERE id = $1", [id]);
    session.accountId = id;
    session.email = a!.email;
    return id;
  };

  describe("POST /api/billing/coupon/redeem", () => {
    it("200 with the credits and their expiry for a valid pilot code", async () => {
      const c = await pilot({ credits: 4 });
      await asAccount();
      const res = await post(redeemRoute, { code: c.code });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ credits: 4, replayed: false });
    });
    it.each([
      ["unknown", async () => ({ code: "NOSUCHCODE2" }), "COUPON_UNKNOWN"],
      [
        "expired",
        async () => ({ code: (await pilot({ startsAt: subHours(NOW, 216), endsAt: subHours(NOW, 24) })).code }),
        "COUPON_EXPIRED",
      ],
    ])("a %s code is a 4xx with %s's code", async (_name, body, expected) => {
      await asAccount();
      const res = await post(redeemRoute, await body());
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect((await res.json()).code).toBe(expected);
    });
    it("an exhausted code is 4xx COUPON_EXHAUSTED, a second pilot code 409 PILOT_ALREADY_USED", async () => {
      const one = await pilot({ maxRedemptions: 1 });
      await redeem(one, await account());
      await asAccount();
      const exhausted = await post(redeemRoute, { code: one.code });
      expect(exhausted.status).toBeLessThan(500);
      expect((await exhausted.json()).code).toBe("COUPON_EXHAUSTED");
      await post(redeemRoute, { code: (await pilot()).code });
      const second = await post(redeemRoute, { code: (await pilot()).code });
      expect(second.status).toBe(409);
      expect((await second.json()).code).toBe(PILOT_ALREADY_USED);
    });
  });

  describe("POST /api/auth/sign-up with a pilot code", () => {
    it("a refused code is answered with its code and creates no account", async () => {
      session.signupOpen = true;
      const email = `r-${randomUUID()}@verikora.test`;
      const res = await post(signUpRoute, {
        email,
        password: "a-long-enough-password",
        locale: "en",
        acceptTerms: true,
        acceptPrivacy: true,
        pilotCode: "NOSUCHCODE3",
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect((await res.json()).code).toBe("COUPON_UNKNOWN");
      expect(await query("SELECT 1 FROM accounts WHERE email = $1", [email])).toHaveLength(0);
    });
    it("a pilot code does not open a closed sign-up: SIGNUP_CLOSED, whatever the code", async () => {
      session.signupOpen = false;
      const c = await pilot();
      const res = await post(signUpRoute, {
        email: `c-${randomUUID()}@verikora.test`,
        password: "a-long-enough-password",
        locale: "en",
        acceptTerms: true,
        acceptPrivacy: true,
        pilotCode: c.code,
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("SIGNUP_CLOSED");
    });
  });
});
