import type { Query } from "@krizaka/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mailer } from "./mailer";

interface Audited {
  action: string;
  actorId: string | null;
  actorLabel: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}
const audited: Audited[] = [];
const redeemed: { code: string; accountId: string; pilotOnly?: boolean; actorLabel?: string }[] = [];
const pilotRedeemer: { failWith: Error | null } = { failWith: null };

vi.mock("./audit", () => ({
  auditIn: async (_run: unknown, entry: Audited) => void audited.push(entry),
}));
vi.mock("./session", () => ({ tokenHash: (token: string) => `hash:${token}` }));
vi.mock("./coupons/pilot", () => ({
  PILOT_PURPOSE: "demo",
  redeemCreditCode: async (input: { code: string; accountId: string; pilotOnly?: boolean; actorLabel?: string }) => {
    if (pilotRedeemer.failWith) {
      throw pilotRedeemer.failWith;
    }
    redeemed.push(input);
  },
}));

import { HttpError, refuse } from "./http";
import {
  ACCOUNT_EXISTS,
  type Actor,
  INVITE_TTL_DAYS,
  inviteBody,
  invitedSignUpBody,
  inviteManager,
  inviteUrl,
  peekInvitation,
  pendingInvitations,
  PILOT_NOT_AVAILABLE,
  pilotCoupons,
  resendInvitation,
  revokeInvitation,
  signUpWithInvitation,
} from "./signup-invitation";

const NOW = new Date("2026-11-15T10:00:00Z");
const ACTOR: Actor = { id: "admin-1", label: "admin@example.com" };
const INVITATION_ID = "11111111-1111-4111-8111-111111111111";
const COUPON_ID = "22222222-2222-4222-8222-222222222222";

type Call = { text: string; values: unknown[] };
type Row = Record<string, unknown>;

function fakeDb(answer: (text: string, values: unknown[]) => Row[]) {
  const calls: Call[] = [];
  const run = (async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    return answer(text, values);
  }) as Query;
  const transact = async <T>(work: (tx: Query) => Promise<T>): Promise<T> => work(run);
  const sqlOf = (needle: string) => calls.filter((c) => c.text.includes(needle));
  return { run, transact, calls, sqlOf };
}

const invitationRow = (over: Row = {}): Row => ({
  id: INVITATION_ID,
  email: "pm@example.com",
  invited_by: ACTOR.id,
  grant_kind: null,
  grant_ref: null,
  created_at: NOW,
  expires_at: new Date("2026-11-22T10:00:00Z"),
  ...over,
});

const couponRow = (over: Row = {}): Row => ({
  id: COUPON_ID,
  code: "PILOT-A",
  credits: 5,
  credits_valid_days: 30,
  uses_left: 3,
  ...over,
});

let mails: Parameters<Mailer>[0][];
const mail: Mailer = async (m) => void mails.push(m);

beforeEach(() => {
  audited.length = 0;
  redeemed.length = 0;
  pilotRedeemer.failWith = null;
  mails = [];
});

async function refusalOf(work: Promise<unknown>): Promise<HttpError> {
  const error: unknown = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe("the pilot coupons an invitation may carry", () => {
  it("asks for live demo credit codes at the given instant and drops the exhausted ones", async () => {
    const db = fakeDb(() => [
      couponRow(),
      couponRow({ id: "x", code: "PILOT-B", uses_left: 0 }),
      couponRow({ id: "y", code: "PILOT-C", uses_left: null }),
    ]);
    const coupons = await pilotCoupons(db.run, NOW);
    expect(coupons).toEqual([
      { id: COUPON_ID, code: "PILOT-A", credits: 5, validDays: 30, usesLeft: 3 },
      { id: "y", code: "PILOT-C", credits: 5, validDays: 30, usesLeft: null },
    ]);
    expect(db.calls[0]!.values).toEqual(["demo", NOW, 200]);
  });
});

describe("invitation input and link", () => {
  it("normalises the address and requires a language", () => {
    expect(inviteBody.parse({ email: "  PM@Example.COM ", locale: "fr" })).toEqual({
      email: "pm@example.com",
      locale: "fr",
    });
    expect(inviteBody.safeParse({ email: "pm@example.com", locale: "de" }).success).toBe(false);
    expect(inviteBody.safeParse({ email: "nope", locale: "en" }).success).toBe(false);
    expect(inviteBody.safeParse({ email: "pm@example.com", locale: "en", pilotCouponId: "CODE" }).success).toBe(false);
  });
  it("builds the sign-up link of the invitee's language, without a doubled slash, the token encoded", () => {
    expect(inviteUrl("https://app.example.com/", "en", "yi1.a+b")).toBe(
      "https://app.example.com/en/sign-up?invite=yi1.a%2Bb",
    );
  });
  it("takes a pilot from the invitation only and keeps the sign-up fields", () => {
    const parsed = invitedSignUpBody.parse({
      email: "pm@example.com",
      password: "correct horse battery staple",
      acceptTerms: true,
      acceptPrivacy: true,
      invite: "yi1.token",
      pilotCode: "SNEAKY",
    });
    expect(parsed).not.toHaveProperty("pilotCode");
    expect(parsed.invite).toBe("yi1.token");
    expect(parsed.locale).toBe("fr");
  });
});

describe("inviting an address", () => {
  const input = { email: "pm@example.com", locale: "en" as const };

  it("refuses an address that already has a confirmed account, and mails nothing", async () => {
    const db = fakeDb((text) => (text.includes("FROM accounts") ? [{ verified: true }] : []));
    const error = await refusalOf(
      inviteManager({ run: db.transact, mail, baseUrl: "https://a.test" }, ACTOR, input, NOW),
    );
    expect(error.status).toBe(409);
    expect(error.body.code).toBe(ACCOUNT_EXISTS);
    expect(mails).toEqual([]);
    expect(db.sqlOf("signup_invitations")).toEqual([]);
  });

  it("stores the invitation for seven days, mails the link and writes the trail", async () => {
    const db = fakeDb((text) => {
      if (text.includes("FROM accounts")) {
        return [{ verified: false }];
      }
      if (text.includes("INSERT INTO signup_invitations")) {
        return [invitationRow()];
      }
      return [];
    });
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    const invitation = await inviteManager(
      { run: db.transact, mail, baseUrl: "https://a.test/", headers },
      ACTOR,
      input,
      NOW,
    );

    const [insert] = db.sqlOf("INSERT INTO signup_invitations");
    expect(insert!.values.slice(1, 2)).toEqual(["pm@example.com"]);
    expect(insert!.values[3]).toBe(ACTOR.id);
    expect(insert!.values.slice(4, 6)).toEqual([null, null]);
    expect(insert!.values[7]).toEqual(new Date("2026-11-22T10:00:00Z"));
    expect(insert!.values[2]).toMatch(/^hash:yi1\.[A-Za-z0-9_-]{43}$/);

    expect(invitation.email).toBe("pm@example.com");
    expect(mails).toHaveLength(1);
    const sent = mails[0]!;
    expect(sent).toMatchObject({ kind: "signupInvitation", to: "pm@example.com", locale: "en", days: INVITE_TTL_DAYS });
    expect(sent).not.toHaveProperty("pilot");
    const token = String((insert!.values[2] as string).slice("hash:".length));
    expect(sent).toMatchObject({ url: inviteUrl("https://a.test", "en", token) });
    expect(audited).toEqual([
      {
        action: "auth.invitation_sent",
        actorId: ACTOR.id,
        actorLabel: ACTOR.label,
        targetId: INVITATION_ID,
        detail: { email: "pm@example.com", pilot: null, locale: "en" },
        headers,
      },
    ]);
  });

  it("refuses a pilot that is not among the live, non-exhausted coupons", async () => {
    const db = fakeDb((text) => {
      if (text.includes("FROM accounts")) {
        return [];
      }
      if (text.includes("FROM coupons.coupon c")) {
        return [couponRow({ uses_left: 0 })];
      }
      return [];
    });
    const error = await refusalOf(
      inviteManager(
        { run: db.transact, mail, baseUrl: "https://a.test" },
        ACTOR,
        { ...input, pilotCouponId: COUPON_ID },
        NOW,
      ),
    );
    expect(error.status).toBe(422);
    expect(error.body.code).toBe(PILOT_NOT_AVAILABLE);
    expect(mails).toEqual([]);
  });

  it("carries the chosen pilot as a grant and tells the mail how many credits it brings", async () => {
    const db = fakeDb((text) => {
      if (text.includes("FROM accounts")) {
        return [];
      }
      if (text.includes("FROM coupons.coupon c")) {
        return [couponRow()];
      }
      if (text.includes("INSERT INTO signup_invitations")) {
        return [invitationRow({ grant_kind: "coupon", grant_ref: "PILOT-A" })];
      }
      if (text.includes("SELECT credits FROM coupons.coupon")) {
        return [{ credits: 5 }];
      }
      return [];
    });
    await inviteManager(
      { run: db.transact, mail, baseUrl: "https://a.test" },
      ACTOR,
      { ...input, pilotCouponId: COUPON_ID },
      NOW,
    );
    expect(db.sqlOf("INSERT INTO signup_invitations")[0]!.values.slice(4, 6)).toEqual(["coupon", "PILOT-A"]);
    expect(mails[0]).toMatchObject({ pilot: { credits: 5 } });
    expect(audited[0]!.detail).toEqual({ email: "pm@example.com", pilot: "PILOT-A", locale: "en" });
  });

  it("omits the pilot line when its coupon is gone by mail time", async () => {
    const db = fakeDb((text) => {
      if (text.includes("INSERT INTO signup_invitations")) {
        return [invitationRow({ grant_kind: "coupon", grant_ref: "GONE" })];
      }
      return [];
    });
    await inviteManager({ run: db.transact, mail, baseUrl: "https://a.test" }, ACTOR, input, NOW);
    expect(mails[0]).not.toHaveProperty("pilot");
  });

  it("answers a refusal of the package with its status and stable code", async () => {
    const db = fakeDb(() => []);
    const error = await refusalOf(
      inviteManager({ run: db.transact, mail, baseUrl: "https://a.test" }, { id: "", label: "x" }, input, NOW),
    );
    expect(error.status).toBe(400);
    expect(error.body.code).toBe("INVITE_BAD_ACTOR");
  });

  it("lets an unexpected failure through untouched, and a failed mail leaves the error to roll back the transaction", async () => {
    const db = fakeDb((text) => (text.includes("INSERT INTO signup_invitations") ? [invitationRow()] : []));
    const boom = new Error("smtp down");
    await expect(
      inviteManager(
        { run: db.transact, mail: async () => Promise.reject(boom), baseUrl: "https://a.test" },
        ACTOR,
        input,
        NOW,
      ),
    ).rejects.toBe(boom);
    expect(audited).toEqual([]);
  });
});

describe("resending, revoking and listing", () => {
  it("resends with a new link to the same address and writes the resent trail", async () => {
    const db = fakeDb((text) => {
      if (text.startsWith("SELECT id, email")) {
        return [invitationRow()];
      }
      if (text.includes("INSERT INTO signup_invitations")) {
        return [invitationRow()];
      }
      return [];
    });
    const invitation = await resendInvitation(
      { run: db.transact, mail, baseUrl: "https://a.test" },
      ACTOR,
      INVITATION_ID,
      "fr",
      NOW,
    );
    expect(invitation.id).toBe(INVITATION_ID);
    expect(mails[0]).toMatchObject({ kind: "signupInvitation", to: "pm@example.com", locale: "fr" });
    expect(mails[0]).toMatchObject({ url: expect.stringContaining("https://a.test/fr/sign-up?invite=yi1.") });
    expect(audited[0]!.action).toBe("auth.invitation_resent");
  });

  it("answers INVITE_INVALID to a resend of a closed or malformed invitation", async () => {
    const db = fakeDb(() => []);
    const error = await refusalOf(
      resendInvitation({ run: db.transact, mail, baseUrl: "https://a.test" }, ACTOR, "nope", "en", NOW),
    );
    expect(error.body.code).toBe("INVITE_INVALID");
    expect(error.status).toBe(400);
  });

  it("revokes an open invitation and records who did it", async () => {
    const db = fakeDb((text) => (text.includes("SET revoked_at") ? [{ id: INVITATION_ID }] : []));
    const headers = new Headers();
    await revokeInvitation(db.transact, ACTOR, INVITATION_ID, NOW, headers);
    expect(db.calls[0]!.values).toEqual([INVITATION_ID, NOW, ACTOR.id]);
    expect(audited).toEqual([
      {
        action: "auth.invitation_revoked",
        actorId: ACTOR.id,
        actorLabel: ACTOR.label,
        targetId: INVITATION_ID,
        headers,
      },
    ]);
  });

  it("refuses to revoke an invitation that is not open, with no trail line", async () => {
    const db = fakeDb(() => []);
    const error = await refusalOf(revokeInvitation(db.transact, ACTOR, INVITATION_ID, NOW));
    expect(error.body.code).toBe("INVITE_INVALID");
    expect(audited).toEqual([]);
  });

  it("lists the open invitations still valid at the instant, bounded", async () => {
    const db = fakeDb(() => [invitationRow({ grant_kind: "coupon", grant_ref: "PILOT-A" })]);
    const list = await pendingInvitations(db.run, NOW);
    expect(list).toEqual([
      {
        id: INVITATION_ID,
        email: "pm@example.com",
        invitedBy: ACTOR.id,
        grant: { kind: "coupon", ref: "PILOT-A" },
        createdAt: NOW,
        expiresAt: new Date("2026-11-22T10:00:00Z"),
      },
    ]);
    expect(db.calls[0]!.values).toEqual([NOW, 200]);
  });
});

describe("opening an invitation link", () => {
  const token = `yi1.${"a".repeat(43)}`;
  it("shows the invited address of a valid link", async () => {
    const expiresAt = new Date("2026-11-22T10:00:00Z");
    const db = fakeDb(() => [{ email: "pm@example.com", expires_at: expiresAt }]);
    expect(await peekInvitation(db.run, token, NOW)).toEqual({ email: "pm@example.com", expiresAt });
    expect(db.calls[0]!.values).toEqual([`hash:${token}`, NOW]);
  });
  it("answers null to a link that opens nothing: unknown, or not shaped like a token at all", async () => {
    const db = fakeDb(() => []);
    expect(await peekInvitation(db.run, token, NOW)).toBeNull();
    expect(await peekInvitation(db.run, "garbage", NOW)).toBeNull();
    expect(db.calls).toHaveLength(1);
  });
  it("lets a database failure through rather than hiding it as an invalid link", async () => {
    const boom = new Error("db down");
    const run = (async () => Promise.reject(boom)) as Query;
    await expect(peekInvitation(run, token, NOW)).rejects.toBe(boom);
  });
});

describe("signing up through an invitation", () => {
  const token = `yi1.${"b".repeat(43)}`;
  const base = {
    email: "pm@example.com",
    password: "correct horse battery staple",
    locale: "en" as const,
    acceptTerms: true as const,
    acceptPrivacy: true as const,
    invite: token,
  };
  const redeemRow = (over: Row = {}) => invitationRow(over);
  const deps = (db: ReturnType<typeof fakeDb>, headers?: Headers) => ({
    run: db.transact,
    ip: "203.0.113.9",
    idempotencyKey: "key-1",
    ...(headers ? { headers } : {}),
  });

  it("creates the account with the address verified and records the redemption", async () => {
    const db = fakeDb((text) => {
      if (text.includes("UPDATE signup_invitations")) {
        return [redeemRow()];
      }
      if (text.includes("FROM accounts")) {
        return [];
      }
      if (text.includes("INSERT INTO accounts")) {
        return [{ id: "acc-1" }];
      }
      return [];
    });
    const result = await signUpWithInvitation(deps(db), base, NOW);
    expect(result).toEqual({ accountId: "acc-1", pilot: false });
    const [insert] = db.sqlOf("INSERT INTO accounts");
    expect(insert!.values[0]).toBe("pm@example.com");
    expect(insert!.values[1]).toBe("en");
    expect(String(insert!.values[2])).not.toContain(base.password);
    expect(insert!.values[4]).toBe(NOW);
    expect(db.sqlOf("UPDATE signup_invitations")[0]!.values).toEqual([`hash:${token}`, "pm@example.com", NOW]);
    expect(redeemed).toEqual([]);
    expect(audited).toEqual([
      {
        action: "auth.invitation_redeemed",
        actorId: "acc-1",
        actorLabel: "pm@example.com",
        detail: { invitedBy: ACTOR.id, pilot: null, granted: false },
      },
    ]);
  });

  it("takes over the unconfirmed account an earlier sign-up left, instead of inserting a second one", async () => {
    const db = fakeDb((text) => {
      if (text.includes("UPDATE signup_invitations")) {
        return [redeemRow()];
      }
      if (text.includes("FROM accounts")) {
        return [{ id: "acc-old", verified: false }];
      }
      return [];
    });
    const result = await signUpWithInvitation(deps(db), base, NOW);
    expect(result.accountId).toBe("acc-old");
    expect(db.sqlOf("INSERT INTO accounts")).toEqual([]);
    const [update] = db.sqlOf("UPDATE accounts");
    expect(update!.values[5]).toBe("acc-old");
    expect(update!.values[4]).toBe(NOW);
  });

  it("refuses an address that was confirmed in the meantime, with the invitation rolled back by the error", async () => {
    const db = fakeDb((text) => {
      if (text.includes("UPDATE signup_invitations")) {
        return [redeemRow()];
      }
      if (text.includes("FROM accounts")) {
        return [{ id: "acc-old", verified: true }];
      }
      return [];
    });
    const error = await refusalOf(signUpWithInvitation(deps(db), base, NOW));
    expect(error.status).toBe(409);
    expect(error.body.code).toBe(ACCOUNT_EXISTS);
    expect(audited).toEqual([]);
  });

  it("answers 403 INVITE_WRONG_ADDRESS when the link is good but belongs to another address", async () => {
    const db = fakeDb((text) => (text.includes("SELECT id FROM signup_invitations") ? [{ id: INVITATION_ID }] : []));
    const error = await refusalOf(signUpWithInvitation(deps(db), base, NOW));
    expect(error.status).toBe(403);
    expect(error.body.code).toBe("INVITE_WRONG_ADDRESS");
    expect(db.sqlOf("accounts")).toEqual([]);
  });

  it("answers INVITE_INVALID for an expired, used or unknown link", async () => {
    const db = fakeDb(() => []);
    const error = await refusalOf(signUpWithInvitation(deps(db), base, NOW));
    expect(error.body.code).toBe("INVITE_INVALID");
  });

  it("redeems the invitation's pilot under a savepoint and says so", async () => {
    const db = fakeDb((text) => {
      if (text.includes("UPDATE signup_invitations")) {
        return [redeemRow({ grant_kind: "coupon", grant_ref: "PILOT-A" })];
      }
      if (text.includes("INSERT INTO accounts")) {
        return [{ id: "acc-1" }];
      }
      return [];
    });
    const result = await signUpWithInvitation(deps(db), base, NOW);
    expect(result).toEqual({ accountId: "acc-1", pilot: true });
    expect(redeemed).toEqual([
      expect.objectContaining({ code: "PILOT-A", accountId: "acc-1", pilotOnly: true, actorLabel: "invitation" }),
    ]);
    const savepoints = db.calls.map((c) => c.text).filter((t) => t.includes("SAVEPOINT"));
    expect(savepoints).toEqual(["SAVEPOINT invitation_pilot", "RELEASE SAVEPOINT invitation_pilot"]);
    expect(audited[0]!.detail).toEqual({ invitedBy: ACTOR.id, pilot: "PILOT-A", granted: true });
  });

  it("keeps the account when the pilot is refused: rolls back to the savepoint and leaves a trail line with the code", async () => {
    pilotRedeemer.failWith = refuse(409, "COUPON_EXHAUSTED", "gone");
    const db = fakeDb((text) => {
      if (text.includes("UPDATE signup_invitations")) {
        return [redeemRow({ grant_kind: "coupon", grant_ref: "PILOT-A" })];
      }
      if (text.includes("INSERT INTO accounts")) {
        return [{ id: "acc-1" }];
      }
      return [];
    });
    const headers = new Headers();
    const result = await signUpWithInvitation(deps(db, headers), base, NOW);
    expect(result).toEqual({ accountId: "acc-1", pilot: false });
    const savepoints = db.calls.map((c) => c.text).filter((t) => t.includes("SAVEPOINT"));
    expect(savepoints).toEqual(["SAVEPOINT invitation_pilot", "ROLLBACK TO SAVEPOINT invitation_pilot"]);
    expect(audited.map((a) => a.action)).toEqual(["billing.pilot_refused", "auth.invitation_redeemed"]);
    expect(audited[0]).toMatchObject({ actorId: "acc-1", detail: { at: "invitation", reason: "COUPON_EXHAUSTED" } });
    expect(audited[1]!.detail).toMatchObject({ pilot: "PILOT-A", granted: false });
  });

  it("records a generic reason when the pilot failed for an unexpected cause", async () => {
    pilotRedeemer.failWith = new Error("boom");
    const db = fakeDb((text) => {
      if (text.includes("UPDATE signup_invitations")) {
        return [redeemRow({ grant_kind: "coupon", grant_ref: "PILOT-A" })];
      }
      if (text.includes("INSERT INTO accounts")) {
        return [{ id: "acc-1" }];
      }
      return [];
    });
    await signUpWithInvitation(deps(db), base, NOW);
    expect(audited[0]!.detail).toEqual({ at: "invitation", reason: "ERROR" });
  });
});
