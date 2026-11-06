import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { deleteDocument, documentStorage, getFile, readBytes } from "./documents";
import { purgeDocument, purgeExpired } from "./retention";
import { memoryStore } from "./storage/memory";

/** ADR-0012: the bytes of a document live in the store, the row carries `object_key` (PostgreSQL; skipped without the database test switch). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-28T12:00:00Z");
const BYTES = new TextEncoder().encode("BAIL DE LOGEMENT\nLoyer mensuel : 1 450 $.\n");

describe.runIf(enabled)("document bytes in the store (ADR-0012)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const store = () => memoryStore({ kind: "none", devOnly: true, owner: "krizaka", residency: "elsewhere" });
  const holder = (s: ReturnType<typeof store>) => async () => s;
  const account = async () =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`o-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!.id;
  /** A not-kept document whose bytes are in the store under its key (what the write path of ADR-0012 produces). */
  const stored = async (s: ReturnType<typeof store>, opts: { retainUntil?: Date | null } = {}) => {
    const owner = await account();
    const id = (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, text, storage, retain_until) VALUES ($1, 'bail', 'bail.txt', 'text/plain', 'lease', $2, $3, ''::bytea, 'Loyer', 'none', $4) RETURNING id",
        [owner, BYTES.length, Math.random().toString(16).slice(2).padEnd(64, "0"), opts.retainUntil ?? null],
      )
    )[0]!.id;
    const key = `${owner}/${id}/original.txt`;
    await s.put(key, BYTES, { contentType: "text/plain" });
    await query("UPDATE documents SET object_key = $2 WHERE id = $1", [id, key]);
    return { owner, id, key };
  };
  const row = async (id: string) =>
    (
      await query<{ object_key: string | null; text: string; len: number }>(
        "SELECT object_key, text, octet_length(content) AS len FROM documents WHERE id = $1",
        [id],
      )
    )[0]!;

  it("has an object_key column, null by default", async () => {
    const [col] = await query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'object_key'",
    );
    expect(col?.is_nullable).toBe("YES");
  });

  it("reads the bytes from the store by the row's key, else from the column (legacy), else 409 NOT_KEPT", async () => {
    const s = store();
    const { owner, id, key } = await stored(s);
    const fromStore = await getFile(owner, id, s);
    expect(new Uint8Array(fromStore.content)).toEqual(BYTES);
    expect(
      await readBytes(
        { mime_type: "text/plain", content: Buffer.from("legacy"), storage: "database", object_key: null },
        { ownerId: owner, id },
        s,
      ),
    ).toEqual(Buffer.from("legacy"));
    await expect(
      readBytes(
        { mime_type: "text/plain", content: Buffer.alloc(0), storage: "none", object_key: null },
        { ownerId: owner, id },
        s,
      ),
    ).rejects.toMatchObject({ status: 409, body: { code: "NOT_KEPT" } });
    await expect(
      readBytes(
        { mime_type: "text/plain", content: Buffer.alloc(0), storage: "none", object_key: key },
        { ownerId: owner, id },
        undefined,
      ),
    ).rejects.toMatchObject({ status: 409, body: { code: "STORAGE_UNAVAILABLE" } });
  });

  it("a document held in the store is not « purged » yet", async () => {
    const s = store();
    const { owner, id } = await stored(s);
    expect((await documentStorage(owner, id, () => s.describe())).purged).toBe(false);
  });

  it("the purge deletes the stored file first, then clears the row, with the same audit row", async () => {
    const s = store();
    const { id, key } = await stored(s);
    expect(await purgeDocument(query, id, "after-check", holder(s))).toBe(true);
    expect(await s.get(key)).toBeNull();
    expect(await row(id)).toMatchObject({ object_key: null, text: "", len: 0 });
    const audits = await query("SELECT 1 FROM audit_log WHERE action = 'document.purged' AND target_id = $1", [id]);
    expect(audits).toHaveLength(1);
  });

  it("a store that does not answer keeps the row and its file for the next sweep", async () => {
    const s = store();
    const { id, key } = await stored(s);
    const broken = {
      ...s,
      delete: async () => {
        throw new Error("store down");
      },
    };
    expect(await purgeDocument(query, id, "after-check", async () => broken)).toBe(false);
    expect(await row(id)).toMatchObject({ object_key: key, text: "Loyer" });
    expect(await s.get(key)).not.toBeNull();
    expect(await purgeDocument(query, id, "after-check", holder(s))).toBe(true);
  });

  it("without a store to ask, a stored document is kept, never half purged", async () => {
    const s = store();
    const { id } = await stored(s);
    expect(await purgeDocument(query, id)).toBe(false);
    expect((await row(id)).object_key).not.toBeNull();
  });

  it("the window sweep deletes the files of the documents past their deadline", async () => {
    const s = store();
    const late = await stored(s, { retainUntil: new Date("2026-10-27T00:00:00Z") });
    const early = await stored(s, { retainUntil: new Date("2027-01-01T00:00:00Z") });
    expect(await purgeExpired(query, NOW, holder(s))).toBeGreaterThanOrEqual(1);
    expect(await s.get(late.key)).toBeNull();
    expect(await s.get(early.key)).not.toBeNull();
    expect((await row(early.id)).object_key).toBe(early.key);
  });

  it("an immediate delete removes the file and the row", async () => {
    const s = store();
    const { owner, id, key } = await stored(s);
    await deleteDocument(owner, id, s);
    expect(await s.get(key)).toBeNull();
    expect(await query("SELECT 1 FROM documents WHERE id = $1", [id])).toHaveLength(0);
  });
});
