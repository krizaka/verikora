import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mailer } from "./mailer";

type Call = { text: string; values: unknown[] };
type Row = Record<string, unknown>;
interface Audited {
  action: string;
  actorId: string | null;
  actorLabel: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
  headers?: Headers;
}

const world: { calls: Call[]; answer: (text: string, values: unknown[]) => Row[]; audits: Audited[] } = {
  calls: [],
  answer: () => [],
  audits: [],
};

vi.mock("./db", () => ({
  query: async (text: string, values: unknown[] = []) => {
    world.calls.push({ text, values });
    return world.answer(text, values);
  },
}));
vi.mock("./audit", () => ({ audit: async (entry: Audited) => void world.audits.push(entry) }));
vi.mock("./client-address", () => ({ clientAddress: () => "203.0.113.7" }));
vi.mock("./applicant-file", () => ({ applicantFileOf: async (landlord: string, id: string) => ({ landlord, id }) }));
vi.mock("./owner-report", async (original) => ({
  ...(await original<typeof import("./owner-report")>()),
  ownerReportOf: (file: unknown, hashes: Map<string, string>) => ({ file, hashes: [...hashes] }),
}));

import { HttpError } from "./http";
import { SHARE_DEFAULT_DAYS } from "./owner-report";
import { cleanAddress, createShare, emailShare, listShares, openShare, revokeShare } from "./owner-report-shares";
import { hash } from "./screening";

const NOW = new Date("2026-11-15T10:00:00Z");
const OWNER = { id: "landlord-1", email: "pm@example.com" };
const FILE = "11111111-1111-4111-8111-111111111111";
const SHARE = "22222222-2222-4222-8222-222222222222";

const sqlOf = (needle: string) => world.calls.filter((c) => c.text.includes(needle));
const refusalOf = async (work: Promise<unknown>) => {
  const error: unknown = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
};

/** The manager owns the file; other statements answer through `rest`. */
const owning = (rest: (text: string, values: unknown[]) => Row[] = () => []) => {
  world.answer = (text, values) =>
    text.includes("FROM screenings WHERE id") ? [{ "?column?": 1 }] : rest(text, values);
};

beforeEach(() => {
  world.calls = [];
  world.answer = () => [];
  world.audits = [];
});

describe("the address a link is mailed to", () => {
  it("trims and lower-cases one plain address", () => {
    expect(cleanAddress("  Owner@Example.COM ")).toBe("owner@example.com");
  });
  it.each([
    ["no at sign", "owner.example.com"],
    ["empty local part", "@example.com"],
    ["empty domain", "owner@"],
    ["a display name", "Owner <owner@example.com>"],
    ["a list with a comma", "a@example.com,b@example.com"],
    ["a list with a semicolon", "a@example.com;b@example.com"],
    ["a second at sign", "a@b@example.com"],
    ["a space inside", "own er@example.com"],
    ["a domain without a dot", "owner@localhost"],
    ["a domain starting with a dot", "owner@.example.com"],
    ["a domain ending with a dot", "owner@example.com."],
    ["a quote", 'o"wner@example.com'],
    ["a line break", "owner@example.com\nbcc@evil.test"],
    ["more than 254 characters", `${"a".repeat(250)}@example.com`],
    ["nothing", "   "],
  ])("refuses %s", (_label, raw) => {
    expect(cleanAddress(raw)).toBeNull();
  });
});

describe("creating a link", () => {
  it("stores only the hash of the token, for the default days, and returns the token once", async () => {
    owning((text) => (text.includes("INSERT INTO file_report_shares") ? [{ id: SHARE }] : []));
    const headers = new Headers();
    const created = await createShare(OWNER, FILE, { recipient: "  Owner Inc  " }, NOW, headers);

    expect(created.id).toBe(SHARE);
    expect(created.token).toMatch(/^sc1\.[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toBe(new Date(NOW.getTime() + SHARE_DEFAULT_DAYS * 86_400_000).toISOString());
    const [insert] = sqlOf("INSERT INTO file_report_shares");
    expect(insert!.values).toEqual([
      FILE,
      OWNER.id,
      "Owner Inc",
      hash(created.token),
      NOW,
      new Date(created.expiresAt),
    ]);
    expect(JSON.stringify(insert!.values)).not.toContain(created.token);
    expect(world.audits).toEqual([
      {
        action: "report.shared",
        actorId: OWNER.id,
        actorLabel: OWNER.email,
        targetId: FILE,
        detail: { shareId: SHARE, expiresAt: created.expiresAt },
        headers,
      },
    ]);
  });
  it("honours the days asked within the allowed range and keeps a recipient to 120 characters", async () => {
    owning((text) => (text.includes("INSERT") ? [{ id: SHARE }] : []));
    const created = await createShare(OWNER, FILE, { recipient: "x".repeat(300), days: 3 }, NOW);
    expect(created.expiresAt).toBe("2026-11-18T10:00:00.000Z");
    expect(String(sqlOf("INSERT")[0]!.values[2])).toHaveLength(120);
  });
  it("answers 404 for a file that is not the manager's, or not a file id, before writing anything", async () => {
    world.answer = () => [];
    expect((await refusalOf(createShare(OWNER, FILE, {}, NOW))).status).toBe(404);
    expect((await refusalOf(createShare(OWNER, "not-a-uuid", {}, NOW))).body.code).toBe("NOT_FOUND");
    expect(sqlOf("INSERT")).toEqual([]);
    expect(world.audits).toEqual([]);
    expect(world.calls[0]!.values).toEqual([FILE, OWNER.id]);
  });
});

describe("listing links", () => {
  it("forgets the mailed address of ended links, then lists newest first with state and view counts", async () => {
    const live = {
      id: "s1",
      recipient: "A",
      created_at: NOW,
      expires_at: new Date("2026-11-20T00:00:00Z"),
      revoked_at: null,
      emailed_to: "a@x.test",
      views: "3",
    };
    const expired = { ...live, id: "s2", expires_at: new Date("2026-11-01T00:00:00Z"), emailed_to: null, views: "0" };
    const revoked = { ...live, id: "s3", revoked_at: new Date("2026-11-10T00:00:00Z"), views: "1" };
    owning((text) => (text.includes("SELECT s.id") ? [live, expired, revoked] : []));
    const shares = await listShares(OWNER.id, FILE, NOW);
    const [forget] = sqlOf("SET emailed_to = NULL");
    expect(forget!.values).toEqual([FILE, OWNER.id, NOW]);
    expect(shares).toEqual([
      {
        id: "s1",
        recipient: "A",
        state: "live",
        createdAt: NOW.toISOString(),
        expiresAt: "2026-11-20T00:00:00.000Z",
        emailedTo: "a@x.test",
        views: 3,
      },
      {
        id: "s2",
        recipient: "A",
        state: "expired",
        createdAt: NOW.toISOString(),
        expiresAt: "2026-11-01T00:00:00.000Z",
        emailedTo: null,
        views: 0,
      },
      {
        id: "s3",
        recipient: "A",
        state: "revoked",
        createdAt: NOW.toISOString(),
        expiresAt: "2026-11-20T00:00:00.000Z",
        emailedTo: "a@x.test",
        views: 1,
      },
    ]);
  });
  it("lists nothing of a file that is not the manager's", async () => {
    expect((await refusalOf(listShares(OWNER.id, FILE, NOW))).status).toBe(404);
    expect(sqlOf("file_report_shares")).toEqual([]);
  });
});

describe("revoking a link", () => {
  it("revokes an open link of the file, drops its mailed address and writes the trail", async () => {
    owning((text) => (text.includes("SET revoked_at") ? [{ id: SHARE }] : []));
    await revokeShare(OWNER, FILE, SHARE);
    expect(sqlOf("SET revoked_at")[0]!.values).toEqual([SHARE, FILE, OWNER.id]);
    expect(sqlOf("SET emailed_to = NULL WHERE id")[0]!.values).toEqual([SHARE]);
    expect(world.audits[0]).toMatchObject({
      action: "report.share_revoked",
      targetId: FILE,
      detail: { shareId: SHARE },
    });
  });
  it("answers 404 for a malformed link id, and for a link already revoked or not the file's", async () => {
    owning();
    expect((await refusalOf(revokeShare(OWNER, FILE, "nope"))).body.code).toBe("NOT_FOUND");
    expect((await refusalOf(revokeShare(OWNER, FILE, SHARE))).status).toBe(404);
    expect(world.audits).toEqual([]);
    expect(sqlOf("SET emailed_to = NULL")).toEqual([]);
  });
});

describe("mailing a link to the owner", () => {
  const input = { token: "sc1.tok", email: " Owner@Example.com ", locale: "fr" as const };
  const mails: Parameters<Mailer>[0][] = [];
  const mail: Mailer = async (m) => void mails.push(m);
  const deps = { mail, origin: "https://app.test" };
  const live = { id: SHARE, expires_at: new Date("2026-11-20T04:00:00Z"), revoked_at: null };
  const found = (row: Row | null) => owning((text) => (text.includes("WHERE token_hash") ? (row ? [row] : []) : []));
  beforeEach(() => {
    mails.length = 0;
  });

  it("mails the link, expiry and note (never the report), keeps the address and audits a hash of it", async () => {
    found(live);
    const manager = { ...OWNER, name: "  Marie Gestion " };
    const sent = await emailShare(manager, FILE, { ...input, message: "  Bonjour  " }, deps, NOW);
    expect(sent).toEqual({ sentTo: "owner@example.com" });
    expect(sqlOf("WHERE token_hash")[0]!.values).toEqual([hash("sc1.tok"), OWNER.id, FILE]);
    expect(mails).toEqual([
      {
        kind: "reportLink",
        to: "owner@example.com",
        locale: "fr",
        url: "https://app.test/fr/rapport/sc1.tok",
        senderName: "Marie Gestion",
        expiresOn: "2026-11-19",
        message: "Bonjour",
      },
    ]);
    expect(sqlOf("SET emailed_to = $2")[0]!.values).toEqual([SHARE, "owner@example.com"]);
    expect(world.audits[0]).toMatchObject({
      action: "report.emailed",
      detail: { shareId: SHARE, to: hash("owner@example.com"), locale: "fr" },
    });
    expect(JSON.stringify(world.audits[0])).not.toContain("owner@example.com");
  });
  it("signs with the product's name when the manager has none, and leaves out an empty note", async () => {
    found(live);
    await emailShare({ ...OWNER, name: null }, FILE, { ...input, message: "   " }, deps, NOW);
    expect(mails[0]).not.toHaveProperty("message");
    expect(String((mails[0] as { senderName: string }).senderName).length).toBeGreaterThan(0);
  });
  it("refuses an invalid address with 400 before looking for the link", async () => {
    found(live);
    const error = await refusalOf(
      emailShare({ ...OWNER, name: null }, FILE, { ...input, email: "a@b.c, d@e.f" }, deps, NOW),
    );
    expect(error.status).toBe(400);
    expect(sqlOf("WHERE token_hash")).toEqual([]);
  });
  it.each([
    ["unknown", null],
    ["expired", { ...live, expires_at: new Date("2026-11-15T10:00:00Z") }],
    ["revoked", { ...live, revoked_at: new Date("2026-11-14T00:00:00Z") }],
  ])("answers the same 404 for a link that is %s, mailing nothing", async (_label, row) => {
    found(row);
    const error = await refusalOf(emailShare({ ...OWNER, name: null }, FILE, input, deps, NOW));
    expect(error.status).toBe(404);
    expect(mails).toEqual([]);
    expect(world.audits).toEqual([]);
  });
});

describe("opening a link by its token", () => {
  const share = {
    id: SHARE,
    screening_id: FILE,
    landlord_id: OWNER.id,
    expires_at: new Date("2026-11-20T00:00:00Z"),
    revoked_at: null,
  };
  const opening = (row: Row | null) =>
    (world.answer = (text) => {
      if (text.includes("FROM file_report_shares WHERE token_hash")) {
        return row ? [row] : [];
      }
      if (text.includes("FROM documents")) {
        return [{ id: "d1", sha256: "h1" }];
      }
      return [];
    });

  it("returns the redacted report with the link's expiry, records the opening and the trail", async () => {
    opening(share);
    const headers = new Headers();
    const report = await openShare("sc1.tok", NOW, headers);
    expect(sqlOf("WHERE token_hash")[0]!.values).toEqual([hash("sc1.tok")]);
    expect(report).toEqual({
      file: { landlord: OWNER.id, id: FILE },
      hashes: [["d1", "h1"]],
      expiresAt: "2026-11-20T00:00:00.000Z",
    });
    expect(sqlOf("INSERT INTO file_report_views")[0]!.values).toEqual([SHARE, NOW, "203.0.113.7"]);
    expect(world.audits[0]).toMatchObject({
      action: "report.viewed",
      actorId: null,
      actorLabel: "owner-link",
      targetId: FILE,
      detail: { shareId: SHARE },
    });
  });
  it("records no address when the opening carries no headers", async () => {
    opening(share);
    await openShare("sc1.tok", NOW);
    expect(sqlOf("INSERT INTO file_report_views")[0]!.values).toEqual([SHARE, NOW, null]);
  });
  it.each([
    ["unknown", null],
    ["expired", { ...share, expires_at: NOW }],
    ["revoked", { ...share, revoked_at: new Date("2026-11-14T00:00:00Z") }],
  ])("answers null for a link that is %s, recording nothing", async (_label, row) => {
    opening(row);
    expect(await openShare("sc1.tok", NOW)).toBeNull();
    expect(sqlOf("INSERT INTO file_report_views")).toEqual([]);
    expect(world.audits).toEqual([]);
  });
});
