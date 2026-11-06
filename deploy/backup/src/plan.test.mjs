import { describe, expect, it } from "vitest";

import {
  assertDestination,
  assertDumpClient,
  assertRecipient,
  assertWorthKeeping,
  backupsIn,
  countDifferences,
  dumpKey,
  expired,
  majorOf,
  manifestKeyOf,
  staleness,
} from "./plan.mjs";

const at = (iso) => new Date(iso);
const RECIPIENT = `age1${"q".repeat(58)}`;

describe("names", () => {
  it("sorts in time as a string and round-trips", () => {
    const key = dumpKey("prod", at("2026-10-29T03:15:00Z"));
    expect(key).toBe("backups/verikora/prod/verikora-prod-20261029T031500Z.dump.age");
    expect(manifestKeyOf(key)).toBe("backups/verikora/prod/verikora-prod-20261029T031500Z.manifest.json");
    expect(backupsIn([{ key, size: 1 }], "prod")[0].at.toISOString()).toBe("2026-10-29T03:15:00.000Z");
  });
  it("refuses an environment that is not a key segment", () => {
    expect(() => dumpKey("../x", at("2026-10-29T00:00:00Z"))).toThrow(/environment/);
  });
  it("ignores foreign objects: they are never listed for deletion", () => {
    const listed = [
      { key: "backups/verikora/prod/notes.txt", size: 1 },
      { key: "backups/verikora/dev/verikora-dev-20260101T000000Z.dump.age", size: 1 },
    ];
    expect(backupsIn(listed, "prod")).toEqual([]);
  });
});

describe("retention", () => {
  const make = (days) => days.map((d) => ({ key: `k${d}`, size: 1, at: new Date(Date.UTC(2026, 9, 29 - d, 3)) }));
  const now = at("2026-10-29T12:00:00Z");
  it("removes the copies older than the window", () => {
    expect(expired(make([0, 1, 2, 3, 4, 5, 6, 7, 31, 45]), now, 30, 7)).toEqual(["k31", "k45"]);
  });
  it("never removes the newest ones, even when every copy is old", () => {
    expect(expired(make([40, 41, 42, 43, 44, 45, 46, 47]), now, 30, 7)).toEqual(["k47"]);
  });
  it("keeps all inside the window", () => {
    expect(expired(make([0, 1, 29]), now, 30, 1)).toEqual([]);
  });
});

describe("freshness", () => {
  const b = (iso) => [{ key: "k", size: 1, at: at(iso) }];
  it("passes for last night", () =>
    expect(staleness(b("2026-10-29T03:00:00Z"), at("2026-10-29T12:00:00Z"))).toBeNull());
  it("fails when the newest is too old", () =>
    expect(staleness(b("2026-10-27T03:00:00Z"), at("2026-10-29T12:00:00Z"))?.code).toBe("STALE"));
  it("fails when there is none", () => expect(staleness([], at("2026-10-29T12:00:00Z"))?.code).toBe("NO_BACKUP"));
});

describe("the drill's comparison", () => {
  it("is empty when every table has the same count", () =>
    expect(countDifferences({ "public.a": 2, "public.b": 0 }, { "public.a": 2, "public.b": 0 })).toEqual([]));
  it("names a differing, a missing and an extra table", () => {
    expect(countDifferences({ "public.a": 2, "public.b": 1 }, { "public.a": 1, "public.c": 4 })).toEqual([
      { table: "public.a", source: 2, restored: 1 },
      { table: "public.b", source: 1, restored: null },
      { table: "public.c", source: null, restored: 4 },
    ]);
  });
  it("refuses a dump of nothing", () => {
    expect(() => assertWorthKeeping({})).toThrow(/no table/);
    expect(() => assertWorthKeeping({ "public.a": 0 })).toThrow(/empty/);
    expect(() => assertWorthKeeping({ "public.a": 0, "public.b": 3 })).not.toThrow();
  });
});

describe("guards", () => {
  it("pg_dump older than the server fails", () => {
    expect(() => assertDumpClient(17, 16)).toThrow(/older/);
    expect(() => assertDumpClient(16, 17)).not.toThrow();
    expect(majorOf("pg_dump (PostgreSQL) 17.2")).toBe(17);
    expect(majorOf("16.4 (Debian)")).toBe(16);
  });
  it("only an age public key is accepted, a private one is refused", () => {
    expect(assertRecipient(RECIPIENT)).toBe(RECIPIENT);
    expect(() => assertRecipient("AGE-SECRET-KEY-1ABCDEF")).toThrow(/never be on the server/);
    expect(() => assertRecipient("")).toThrow(/not set/);
    expect(() => assertRecipient("hello")).toThrow(/not an age public key/);
  });
  it("the destination must exist, be verified and be in Canada", () => {
    expect(() => assertDestination(null, "canada")).toThrow(/no backup destination/);
    expect(() => assertDestination({ status: "draft" }, "canada")).toThrow(/not verified/);
    expect(() => assertDestination({ status: "active" }, "elsewhere")).toThrow(/not in Canada/);
    expect(() => assertDestination({ status: "active" }, "canada")).not.toThrow();
  });
});
