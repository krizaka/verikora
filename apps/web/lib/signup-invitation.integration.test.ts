import { randomUUID } from "node:crypto";

import { hashPassword } from "@krizaka/auth";
import { subHours } from "@krizaka/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mails = vi.hoisted(() => [] as { kind: string; to: string; locale: string; url: string; days?: number }[]);
vi.mock("./mailer", async (original) => ({
  ...(await original<typeof import("./mailer")>()),
  mailerFor: () => async (mail: (typeof mails)[number]) => void mails.push(mail),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77" }),
}));

import { POST as inviteAction } from "@/app/api/admin/invitations/[id]/route";
import { GET as listInvitations, POST as inviteRoute } from "@/app/api/admin/invitations/route";
import { POST as signIn } from "@/app/api/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/auth/sign-up/route";

import { entitlementOf, reserveAudit } from "./billing";
import { coupons } from "./coupons/instance";
import { migrate, pool, query, transaction } from "./db";
import { env } from "./env";
import { resetRateLimits } from "./limits";
import { appSettings } from "./settings/instance";
import { GLOBAL } from "./settings/service";
import { signupOpenNow } from "./settings/signup";
import { peekInvitation, pilotCoupons } from "./signup-invitation";

/**
 * Invitation-only sign-up (krizaka-internal#3230) against a real PostgreSQL, through the real routes (skipped without DATABASE_IT=1 and DATABASE_URL). Sign-up stays
 * closed throughout: `signup.open` is off and no mail provider is configured, so `signupOpenNow` is false; only an invitation lets an account in.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date();
const PASSWORD = "correct horse battery staple";
const ADMIN = { id: null, label: "admin@verikora.test" };
const stamp = Date.now();

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.70", ...headers },
    body: JSON.stringify(body),
  });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tokenOf = (url: string) => new URL(url).searchParams.get("invite")!;

describe.runIf(enabled)("invitation-only sign-up", () => {
  let adminToken = "";
  let userToken = "";
  const address = (who: string) => `inv-${who}-${stamp}@verikora.test`;

  const account = async (email: string, role = "USER") => {
    await query(
      "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at, role, locale) VALUES ($1, $2, now(), now(), $3, 'en')",
      [email, await hashPassword(PASSWORD), role],
    );
    const res = await signIn(json("/api/auth/sign-in", { email, password: PASSWORD, client: "native" }));
    return ((await res.json()) as { token: string }).token;
  };
  const pilot = (over: Record<string, unknown> = {}) =>
    transaction((tx) =>
      coupons.admin.create(tx, ADMIN, {
        code: `PI${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
        kind: "credit",
        purpose: "demo",
        startsAt: subHours(NOW, 24),
        credits: 3,
        creditsValidDays: 30,
        maxRedemptions: 5,
        onExhausted: "stop",
        ...over,
      }),
    );
  const invite = async (email: string, extra: Record<string, unknown> = {}, token = adminToken) =>
    inviteRoute(json("/api/admin/invitations", { email, locale: "fr", ...extra }, bearer(token)));
  const invited = async (email: string, extra: Record<string, unknown> = {}) => {
    const res = await invite(email, extra);
    expect(res.status).toBe(201);
    const { invitation } = (await res.json()) as { invitation: { id: string } };
    return { id: invitation.id, token: tokenOf(mails.at(-1)!.url) };
  };
  const signUp = (body: Record<string, unknown>) =>
    signUpRoute(
      json("/api/auth/sign-up", {
        password: PASSWORD,
        locale: "fr",
        acceptTerms: true,
        acceptPrivacy: true,
        ...body,
      }),
    );
  const codeOf = async (res: Response) => ((await res.json()) as { code?: string }).code;

  beforeAll(async () => {
    // Mail is configured (and captured): sign-up is closed by its setting alone.
    vi.stubEnv("MAIL_PROVIDER", "mailgun");
    vi.stubEnv("MAIL_API_KEY", "test-only");
    vi.stubEnv("MAIL_DOMAIN", "mail.verikora.test");
    await migrate();
    await appSettings().set(ADMIN, GLOBAL, "coupons.enabled", true, NOW);
    await appSettings().set(ADMIN, GLOBAL, "signup.open", false, NOW);
    adminToken = await account(address("admin"), "ADMIN");
    userToken = await account(address("user"));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool().end();
  });
  beforeEach(() => {
    resetRateLimits();
    mails.length = 0;
  });

  it("sign-up is closed for this whole suite, and a closed sign-up without an invitation is SIGNUP_CLOSED", async () => {
    expect(await signupOpenNow(env())).toBe(false);
    const res = await signUp({ email: address("nobody") });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("SIGNUP_CLOSED");
    expect(await query("SELECT 1 FROM accounts WHERE email = $1", [address("nobody")])).toHaveLength(0);
  });

  it("the admin invites: a mail with the sign-up link and its lifetime; the token is in no log and no audit line", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" "))),
    );
    const { id, token } = await invited(address("mail"));
    spies.forEach((s) => s.mockRestore());
    const mail = mails.at(-1)!;
    expect(mail).toMatchObject({ kind: "signupInvitation", to: address("mail"), locale: "fr", days: 7 });
    expect(mail.url).toMatch(/^http.+\/fr\/sign-up\?invite=yi1\.[A-Za-z0-9_-]{43}$/);
    expect(logged.some((line) => line.includes(token))).toBe(false);
    const trail = await query<{ action: string; detail: unknown; actor_label: string }>(
      "SELECT action, detail, actor_label FROM audit.entry WHERE target_id = $1",
      [id],
    );
    expect(trail.map((t) => t.action)).toEqual(["auth.invitation_sent"]);
    expect(trail[0]!.actor_label).toBe(address("admin"));
    expect(JSON.stringify(trail)).not.toContain(token);
    expect(JSON.stringify(trail)).toContain(address("mail"));
    const [stored] = await query<{ token_hash: string }>("SELECT token_hash FROM signup_invitations WHERE id = $1", [
      id,
    ]);
    expect(stored!.token_hash).not.toContain(token);
  });

  it("peek: a valid link answers its address; any other link answers nothing", async () => {
    const { token } = await invited(address("peek"));
    expect((await peekInvitation(query, token, new Date()))?.email).toBe(address("peek"));
    expect(await peekInvitation(query, "yi1." + "A".repeat(43), new Date())).toBeNull();
    expect(await peekInvitation(query, "not-a-token", new Date())).toBeNull();
  });

  it("with an invitation while sign-up is closed: the account is created verified, with the pilot pot, in one go", async () => {
    const code = await pilot({ credits: 3 });
    const { token } = await invited(address("pilot"), { pilotCouponId: code.id });
    const res = await signUp({ email: address("pilot"), invite: token });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, verified: true, pilot: true });
    expect(mails.filter((m) => m.kind === "confirmEmail")).toHaveLength(0);
    const [created] = await query<{ id: string; verified: boolean }>(
      "SELECT id, email_verified_at IS NOT NULL AS verified FROM accounts WHERE email = $1",
      [address("pilot")],
    );
    expect(created!.verified).toBe(true);
    expect((await entitlementOf(query, created!.id, new Date())).credits).toBe(3);
    // The account signs in at once: no second confirmation.
    expect((await signIn(json("/api/auth/sign-in", { email: address("pilot"), password: PASSWORD }))).status).toBe(200);
  });

  it("another address than the invited one is INVITE_WRONG_ADDRESS, and the link stays good", async () => {
    const { token } = await invited(address("right"));
    const res = await signUp({ email: address("wrong"), invite: token });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("INVITE_WRONG_ADDRESS");
    expect(await query("SELECT 1 FROM accounts WHERE email = $1", [address("wrong")])).toHaveLength(0);
    expect((await peekInvitation(query, token, new Date()))?.email).toBe(address("right"));
  });

  it("a link used once is INVITE_INVALID the second time", async () => {
    const { token } = await invited(address("twice"));
    expect((await signUp({ email: address("twice"), invite: token })).status).toBe(201);
    const again = await signUp({ email: address("twice"), invite: token });
    expect(again.status).toBe(400);
    expect(await codeOf(again)).toBe("INVITE_INVALID");
  });

  it("two sign-ups racing on one link: exactly one account", async () => {
    const { token } = await invited(address("race"));
    const [a, b] = await Promise.all([
      signUp({ email: address("race"), invite: token }),
      signUp({ email: address("race"), invite: token }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await query("SELECT 1 FROM accounts WHERE email = $1", [address("race")])).toHaveLength(1);
  });

  it("a revoked invitation is INVITE_INVALID, and the revocation is on the trail", async () => {
    const { id, token } = await invited(address("revoked"));
    const res = await inviteAction(json(`/api/admin/invitations/${id}`, { action: "revoke" }, bearer(adminToken)), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const refused = await signUp({ email: address("revoked"), invite: token });
    expect(await codeOf(refused)).toBe("INVITE_INVALID");
    const trail = await query<{ action: string }>("SELECT action FROM audit.entry WHERE target_id = $1 ORDER BY at", [
      id,
    ]);
    expect(trail.map((t) => t.action)).toEqual(["auth.invitation_sent", "auth.invitation_revoked"]);
  });

  it("a new invitation of the same address replaces the open one; a resend replaces it too", async () => {
    const first = await invited(address("again"));
    const second = await invited(address("again"));
    expect(await peekInvitation(query, first.token, new Date())).toBeNull();
    expect((await peekInvitation(query, second.token, new Date()))?.email).toBe(address("again"));
    const resent = await inviteAction(
      json(`/api/admin/invitations/${second.id}`, { action: "resend", locale: "en" }, bearer(adminToken)),
      { params: Promise.resolve({ id: second.id }) },
    );
    expect(resent.status).toBe(200);
    const third = tokenOf(mails.at(-1)!.url);
    expect(mails.at(-1)!.url).toContain("/en/sign-up?invite=");
    expect(await peekInvitation(query, second.token, new Date())).toBeNull();
    expect((await peekInvitation(query, third, new Date()))?.email).toBe(address("again"));
  });

  it("the pilot select lists live, non-exhausted pilot coupons only; another coupon is PILOT_NOT_AVAILABLE", async () => {
    const live = await pilot();
    const paused = await pilot();
    await transaction((tx) => coupons.admin.pause(tx, ADMIN, paused.id));
    const promo = await pilot({ purpose: "promo" });
    const ids = (await pilotCoupons(query, new Date())).map((p) => p.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(paused.id);
    expect(ids).not.toContain(promo.id);
    const res = await invite(address("promo"), { pilotCouponId: promo.id });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("PILOT_NOT_AVAILABLE");
    const listed = await listInvitations(
      new Request("http://localhost/api/admin/invitations", { headers: bearer(adminToken) }),
    );
    expect(((await listed.json()) as { pilots: { id: string }[] }).pilots.map((p) => p.id)).toContain(live.id);
  });

  it("a pilot that ran out between the invitation and the sign-up: the account is created anyway, the refusal is on the trail", async () => {
    const code = await pilot({ maxRedemptions: 1 });
    const { token } = await invited(address("late"), { pilotCouponId: code.id });
    // Someone else takes the one use meanwhile.
    const [other] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), now()) RETURNING id",
      [address("other")],
    );
    await coupons.redeemCredit(query, {
      code: code.code,
      accountId: other!.id,
      idempotencyKey: `t-${randomUUID()}`,
      ip: "203.0.113.9",
      hasPaidBefore: false,
    });
    const res = await signUp({ email: address("late"), invite: token });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ verified: true, pilot: false });
    const [late] = await query<{ id: string }>("SELECT id FROM accounts WHERE email = $1", [address("late")]);
    expect((await entitlementOf(query, late!.id, new Date())).credits).toBe(0);
    const [refused] = await query<{ detail: { reason: string } }>(
      "SELECT detail FROM audit.entry WHERE action = 'billing.pilot_refused' AND actor_id = $1",
      [late!.id],
    );
    expect(refused!.detail.reason).toBe("COUPON_EXHAUSTED");
  });

  it("while mail is not configured an invitation is MAIL_OFF, and none is kept", async () => {
    vi.stubEnv("MAIL_API_KEY", "");
    const res = await invite(address("nomail"));
    vi.stubEnv("MAIL_API_KEY", "test-only");
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe("MAIL_OFF");
    expect(await query("SELECT 1 FROM signup_invitations WHERE email = $1", [address("nomail")])).toHaveLength(0);
  });

  it("an address with a confirmed account is not invited (ACCOUNT_EXISTS)", async () => {
    const res = await invite(address("user"));
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("ACCOUNT_EXISTS");
  });

  it("the admin routes refuse a signed-out caller and a non-admin", async () => {
    const anonymous = await inviteRoute(json("/api/admin/invitations", { email: address("x"), locale: "fr" }));
    expect(anonymous.status).toBe(401);
    const user = await invite(address("x"), {}, userToken);
    expect(user.status).toBe(403);
    expect(await codeOf(user)).toBe("FORBIDDEN");
    const list = await listInvitations(
      new Request("http://localhost/api/admin/invitations", { headers: bearer(userToken) }),
    );
    expect(list.status).toBe(403);
    const id = randomUUID();
    const revoke = await inviteAction(json(`/api/admin/invitations/${id}`, { action: "revoke" }, bearer(userToken)), {
      params: Promise.resolve({ id }),
    });
    expect(revoke.status).toBe(403);
    expect(mails).toHaveLength(0);
  });

  it("past the admin's limit the invitation is refused with RATE_LIMITED", async () => {
    const id = randomUUID();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await inviteAction(json(`/api/admin/invitations/${id}`, { action: "revoke" }, bearer(adminToken)), {
        params: Promise.resolve({ id }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    const last = await invite(address("limited"));
    expect(last.status).toBe(429);
    expect(await codeOf(last)).toBe("RATE_LIMITED");
  });

  it("the journey: invited with a pilot code → link → account → a file's audit taken from the pilot, no payment asked, sign-up closed", async () => {
    const code = await pilot({ credits: 2 });
    const { token } = await invited(address("journey"), { pilotCouponId: code.id });
    expect((await peekInvitation(query, token, new Date()))?.email).toBe(address("journey"));
    expect((await signUp({ email: address("journey"), invite: token })).status).toBe(201);
    const signedIn = await signIn(json("/api/auth/sign-in", { email: address("journey"), password: PASSWORD }));
    expect(signedIn.status).toBe(200);
    const [me] = await query<{ id: string }>("SELECT id FROM accounts WHERE email = $1", [address("journey")]);
    const via = await reserveAudit(query, me!.id, new Date(), () => ({
      freeDossiers: 0,
      perDay: 0,
      perMonth: 0,
      overageCents: 0,
    }));
    expect(via).toBe("credit");
    expect((await entitlementOf(query, me!.id, new Date())).credits).toBe(1);
    expect(await signupOpenNow(env())).toBe(false);
  });
});
