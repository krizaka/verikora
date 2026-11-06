import { createHash } from "node:crypto";

import { memoryObjectStore } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { dumpKey, prefixOf } from "./plan.mjs";
import { checkFresh, runBackup } from "./run.mjs";

const RECIPIENT = `age1${"q".repeat(58)}`;
const NOW = new Date("2026-10-29T03:00:00Z");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const text = (s) => new TextEncoder().encode(s);
const AGE = text("age-encryption.org/v1\n-> X25519 abc\n---\nciphertext");

/** Fake ports that record the order of the effects; each can be bent to make one step fail. */
function world(over = {}) {
  const events = [];
  const store = over.store ?? memoryObjectStore();
  const counts = over.counts ?? { "public.documents": 3, "public.users": 2 };
  const ports = {
    clock: { now: () => NOW },
    log: () => {},
    source: {
      serverMajor: async () => 17,
      withSnapshot: async (use) => (events.push("snapshot"), use("00000003-1", counts)),
    },
    tools: {
      clientMajor: async () => over.clientMajor ?? 17,
      dump: async () => (events.push("dump"), "/tmp/plain.dump"),
      encrypt: async () => (events.push("encrypt"), "/tmp/plain.dump.age"),
      remove: async (p) => void events.push(`remove ${p}`),
    },
    scratch: {
      create: async (n) => void events.push(`create ${n}`),
      restore: async () => void events.push("restore"),
      count: async () => over.restored ?? counts,
      drop: async (n) => void events.push(`drop ${n}`),
    },
    files: { read: async () => over.encrypted ?? AGE, sha256: sha },
    destination: {
      provider: { id: "p1", status: "active", coordinates: { region: "ca-central-1" } },
      store,
      residency: over.residency ?? "canada",
    },
  };
  return { ports, events, store };
}
const options = { environment: "prod", recipient: RECIPIENT, retentionDays: 30 };

describe("runBackup", () => {
  it("dumps, proves the restore, encrypts, uploads, writes the manifest and cleans up, in that order", async () => {
    const { ports, events, store } = world();
    const manifest = await runBackup(ports, options);
    expect(events.filter((e) => !e.startsWith("remove"))).toEqual([
      "snapshot",
      "dump",
      "create verikora_drill_" + events[2].slice(-14),
      "restore",
      "encrypt",
      "drop verikora_drill_" + events[2].slice(-14),
    ]);
    expect(manifest.sha256).toBe(sha(AGE));
    expect(manifest.rowCounts).toEqual({ "public.documents": 3, "public.users": 2 });
    const key = dumpKey("prod", NOW);
    expect((await store.get(key)).bytes).toEqual(AGE);
    expect(
      JSON.parse(new TextDecoder().decode((await store.get(key.replace(".dump.age", ".manifest.json"))).bytes)).drill,
    ).toBe("passed");
    expect(events).toContain("remove /tmp/plain.dump");
    expect(events).toContain("remove /tmp/plain.dump.age");
  });

  it("fails loudly and uploads nothing when the restored counts differ, and still drops the scratch database", async () => {
    const { ports, events, store } = world({ restored: { "public.documents": 3, "public.users": 1 } });
    await expect(runBackup(ports, options)).rejects.toMatchObject({
      code: "DRILL_MISMATCH",
      message: expect.stringContaining("public.users 2→1"),
    });
    expect(await store.list(prefixOf("prod"))).toEqual([]);
    expect(events.some((e) => e.startsWith("drop "))).toBe(true);
    expect(events).not.toContain("encrypt");
  });

  it("refuses to upload a file that is not age-encrypted", async () => {
    const { ports, store } = world({ encrypted: text("PGDMP plain dump") });
    await expect(runBackup(ports, options)).rejects.toMatchObject({ code: "NOT_ENCRYPTED" });
    expect(await store.list(prefixOf("prod"))).toEqual([]);
  });

  it("fails before any dump when the destination is not in Canada, the client is too old or the key is private", async () => {
    for (const [over, code] of [
      [{ residency: "elsewhere" }, "NOT_CANADA"],
      [{ clientMajor: 15 }, "CLIENT_TOO_OLD"],
    ]) {
      const { ports, events } = world(over);
      await expect(runBackup(ports, options)).rejects.toMatchObject({ code });
      expect(events).toEqual([]);
    }
    const { ports, events } = world();
    await expect(runBackup(ports, { ...options, recipient: "AGE-SECRET-KEY-1ABC" })).rejects.toMatchObject({
      code: "PRIVATE_KEY_IN_ENV",
    });
    expect(events).toEqual([]);
  });

  it("fails when the destination returns different bytes than were sent", async () => {
    const inner = memoryObjectStore();
    const store = {
      ...inner,
      get: async (k) => (await inner.get(k)) && { bytes: text("tampered"), contentType: "application/octet-stream" },
    };
    const { ports } = world({ store });
    await expect(runBackup(ports, options)).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  });

  it("applies the retention after a good run and leaves foreign objects alone", async () => {
    const store = memoryObjectStore();
    const old = (d) => dumpKey("prod", new Date(Date.UTC(2026, 8, d, 3)));
    for (let d = 1; d <= 9; d++) await store.put(old(d), AGE, { contentType: "application/octet-stream" });
    await store.put(`${prefixOf("prod")}README.txt`, text("keep"), { contentType: "text/plain" });
    const { ports } = world({ store });
    await runBackup(ports, options);
    const keys = (await store.list(prefixOf("prod"))).map((o) => o.key);
    expect(keys).toContain(`${prefixOf("prod")}README.txt`);
    expect(keys).toContain(dumpKey("prod", NOW));
    expect(keys).not.toContain(old(1));
    expect(keys).toContain(old(9));
  });
});

describe("checkFresh", () => {
  it("passes with last night's backup and its manifest, fails without", async () => {
    const { ports, store } = world();
    await expect(checkFresh(store, "prod", NOW)).rejects.toMatchObject({ code: "NO_BACKUP" });
    await runBackup(ports, options);
    await expect(checkFresh(store, "prod", new Date("2026-10-29T12:00:00Z"))).resolves.toBe(dumpKey("prod", NOW));
    await expect(checkFresh(store, "prod", new Date("2026-10-31T12:00:00Z"))).rejects.toMatchObject({ code: "STALE" });
  });
});
