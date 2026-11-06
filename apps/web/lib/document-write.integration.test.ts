import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { getFile, type StoragePolicy, storeDocument } from "./documents";
import { purgeIfDone } from "./retention";
import { memoryStore } from "./storage/memory";
import { noneStore } from "./storage/none";

/** ADR-0012: a new document's bytes go to a store at upload, kept or not; the column stays empty (PostgreSQL; skipped without the database test switch). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-28T12:00:00Z");
const TEXT = "BAIL DE LOGEMENT\nLoyer mensuel : 1 450 $, payable le premier jour du mois.\n";
const file = { name: "bail.txt", type: "text/plain", size: 100 };

describe.runIf(enabled)("the write path puts bytes in the store (ADR-0012)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const account = async () =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`w-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!.id;
  const bytes = (n: string) => new TextEncoder().encode(`${TEXT}${n}`);
  const mem = (kind: "none" | "bunny" = "none") =>
    memoryStore({ kind, devOnly: true, owner: "krizaka", residency: "elsewhere" });
  const policy = (
    keep: boolean,
    working: ReturnType<typeof mem> | null,
    store: ReturnType<typeof mem> | ReturnType<typeof noneStore> = noneStore(),
  ): StoragePolicy => ({ keep, store, working, now: NOW, purgeAfterHours: 24 });
  const rowOf = async (id: string) =>
    (
      await query<{ object_key: string | null; len: number; storage: string }>(
        "SELECT object_key, octet_length(content) AS len, storage FROM documents WHERE id = $1",
        [id],
      )
    )[0]!;

  it("a not-kept document: bytes in the working store under its key, the column empty, readable until the purge", async () => {
    const owner = await account();
    const working = mem();
    const { summary } = await storeDocument(owner, file, bytes("a"), "lease", policy(false, working));
    const row = await rowOf(summary.id);
    expect(row).toMatchObject({ len: 0, storage: "none", object_key: `${owner}/${summary.id}/original.txt` });
    expect(new Uint8Array((await working.get(row.object_key!))!.bytes)).toEqual(bytes("a"));
    expect(new Uint8Array((await getFile(owner, summary.id, working)).content)).toEqual(bytes("a"));
  });

  it("the purge after the check deletes the stored file", async () => {
    const owner = await account();
    const working = mem();
    const { summary } = await storeDocument(owner, file, bytes("b"), "lease", policy(false, working));
    const key = (await rowOf(summary.id)).object_key!;
    expect(await purgeIfDone(query, summary.id, async () => working)).toBe(true);
    expect(await working.get(key)).toBeNull();
    expect(await rowOf(summary.id)).toMatchObject({ object_key: null, len: 0 });
  });

  it("a document kept on an external store: bytes there, none in the working store, none in the column", async () => {
    const owner = await account();
    const working = mem();
    const external = mem("bunny");
    const { summary } = await storeDocument(owner, file, bytes("c"), "lease", policy(true, working, external));
    const row = await rowOf(summary.id);
    expect(row).toMatchObject({ len: 0, storage: "bunny" });
    expect(await external.get(row.object_key!)).not.toBeNull();
    expect(await working.get(row.object_key!)).toBeNull();
    expect(new Uint8Array((await getFile(owner, summary.id, external)).content)).toEqual(bytes("c"));
  });

  it("a document kept where no external store exists still has its bytes in the working store, never in PostgreSQL", async () => {
    const owner = await account();
    const working = mem();
    const { summary } = await storeDocument(owner, file, bytes("d"), "lease", policy(true, working));
    const row = await rowOf(summary.id);
    expect(row).toMatchObject({ len: 0, storage: "database" });
    expect(await working.get(row.object_key!)).not.toBeNull();
  });

  it("a store that does not answer refuses the upload (502) and leaves no row", async () => {
    const owner = await account();
    const broken = {
      ...mem(),
      put: async () => {
        throw new Error("down");
      },
    };
    await expect(storeDocument(owner, file, bytes("e"), "lease", policy(false, broken))).rejects.toMatchObject({
      status: 502,
      body: { code: "STORAGE_UNAVAILABLE" },
    });
    expect(await query("SELECT 1 FROM documents WHERE owner_id = $1", [owner])).toHaveLength(0);
  });

  it("production without a store refuses uploads (503) before anything is written", async () => {
    const owner = await account();
    await expect(storeDocument(owner, file, bytes("f"), "lease", policy(false, null))).rejects.toMatchObject({
      status: 503,
      body: { code: "STORAGE_UNAVAILABLE" },
    });
    expect(await query("SELECT 1 FROM documents WHERE owner_id = $1", [owner])).toHaveLength(0);
  });

  it("no document written by the app ever holds bytes in the column", async () => {
    const owner = await account();
    await storeDocument(owner, file, bytes("g"), "lease", policy(false, mem()));
    await storeDocument(owner, file, bytes("h"), "lease", policy(true, mem()));
    expect(
      await query("SELECT 1 FROM documents WHERE owner_id = $1 AND octet_length(content) > 0", [owner]),
    ).toHaveLength(0);
  });
});
