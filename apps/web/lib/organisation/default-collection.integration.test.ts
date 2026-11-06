import { beforeAll, describe, expect, it } from "vitest";

import { migrate, pool, query } from "../db";
import { BACKFILL_DEFAULT_COLLECTIONS } from "./default-collection";
import * as org from "./store";

/** The default collection (krizaka/verikora#205) against a real PostgreSQL: the database itself keeps one per account, and no file is ever without a collection. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("the default collection", () => {
  beforeAll(async () => {
    await migrate();
  });
  const account = async (locale = "fr") =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at, locale) VALUES ($1, 'x', now(), $2) RETURNING id",
        [`d-${Math.random().toString(36).slice(2)}@verikora.test`, locale],
      )
    )[0]!.id;
  const doc = async (owner: string) =>
    (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, 't', 'f.txt', 'text/plain', 1, $2, 'x') RETURNING id",
        [owner, Math.random().toString(36)],
      )
    )[0]!.id;
  const defaults = (owner: string) =>
    query<{ id: string; name: string }>("SELECT id, name FROM collections WHERE owner_id = $1 AND is_default", [owner]);
  const collectionOf = async (id: string) =>
    (await query<{ collection_id: string | null }>("SELECT collection_id FROM documents WHERE id = $1", [id]))[0]!
      .collection_id;

  it("is created with the account, in its language, whatever created the account", async () => {
    const fr = await account("fr");
    const en = await account("en");
    expect((await defaults(fr)).map((c) => c.name)).toEqual(["Mes documents"]);
    expect((await defaults(en)).map((c) => c.name)).toEqual(["My documents"]);
    const [library] = await query<{ name: string }>("SELECT name FROM libraries WHERE owner_id = $1", [fr]);
    expect(library?.name).toBe("Ma bibliothèque");
  });

  it("takes every file that is given no place, on insert and when a place is removed", async () => {
    const owner = await account();
    const [home] = await defaults(owner);
    const d = await doc(owner);
    expect(await collectionOf(d)).toBe(home!.id);
    const lib = await org.ensureLibrary(query, owner, "x");
    const other = await org.createCollection(query, owner, lib.id, "Baux");
    await org.placeDocument(query, owner, d, { collectionId: other.id, folderId: null });
    expect(await collectionOf(d)).toBe(other.id);
    await org.placeDocument(query, owner, d, { collectionId: null, folderId: null });
    expect(await collectionOf(d)).toBe(home!.id);
    await expect(query("UPDATE documents SET collection_id = NULL WHERE id = $1", [d])).resolves.toBeDefined();
    expect(await collectionOf(d)).toBe(home!.id);
  });

  it("is never deleted: refused by the store (409 DEFAULT_COLLECTION), by the library's deletion and by the database itself", async () => {
    const owner = await account();
    const [home] = await defaults(owner);
    await expect(org.deleteCollection(query, owner, home!.id, { files: "delete" })).rejects.toMatchObject({
      status: 409,
      body: { code: "DEFAULT_COLLECTION" },
    });
    await expect(query("DELETE FROM collections WHERE id = $1", [home!.id])).rejects.toThrow(/DEFAULT_COLLECTION/);
    const [lib] = await query<{ id: string }>("SELECT id FROM libraries WHERE owner_id = $1", [owner]);
    const second = await org.createLibrary(query, owner, "Autre");
    await expect(org.deleteLibrary(query, owner, lib!.id)).rejects.toMatchObject({ status: 409 });
    await expect(query("DELETE FROM libraries WHERE id = $1", [lib!.id])).rejects.toThrow(/DEFAULT_COLLECTION/);
    expect(await defaults(owner)).toHaveLength(1);
    await org.deleteLibrary(query, owner, second.id);
  });

  it("can be renamed", async () => {
    const owner = await account();
    const [home] = await defaults(owner);
    expect((await org.renameCollection(query, owner, home!.id, "Mon coffre")).name).toBe("Mon coffre");
    expect((await defaults(owner))[0]?.name).toBe("Mon coffre");
  });

  it("is exactly one per account: the database refuses a second, and the owner can choose another one — never zero", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "x");
    const [home] = await defaults(owner);
    const other = await org.createCollection(query, owner, lib.id, "Factures");
    await expect(query("UPDATE collections SET is_default = true WHERE id = $1", [other.id])).rejects.toThrow();
    await org.setDefaultCollection(query, owner, other.id);
    expect((await defaults(owner)).map((c) => c.id)).toEqual([other.id]);
    // the old one is a collection like any other now: it can go, and its files move to the new default
    const d = await doc(owner);
    await org.placeDocument(query, owner, d, { collectionId: home!.id, folderId: null });
    await org.deleteCollection(query, owner, home!.id, { files: "move", to: null });
    expect(await collectionOf(d)).toBe(other.id);
    // an account cannot be left without one, even by hand
    await expect(query("UPDATE collections SET is_default = false WHERE id = $1", [other.id])).rejects.toThrow(
      /DEFAULT_COLLECTION/,
    );
    await expect(org.setDefaultCollection(query, owner, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      status: 404,
    });
    expect(await defaults(owner)).toHaveLength(1);
  });

  it("a deleted folder's files go up to its collection; a deleted collection's files go to the default one", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "x");
    const [home] = await defaults(owner);
    const c = await org.createCollection(query, owner, lib.id, "Baux");
    const f = await org.createFolder(query, owner, c.id, "2026");
    const d = await doc(owner);
    await org.placeDocument(query, owner, d, { collectionId: c.id, folderId: f.id });
    await org.deleteFolder(query, owner, f.id, { files: "move", to: null });
    expect(await collectionOf(d)).toBe(c.id);
    await org.deleteCollection(query, owner, c.id, { files: "move", to: null });
    expect(await collectionOf(d)).toBe(home!.id);
  });

  it("deleting an account still deletes its default collection (the guard looks at the account)", async () => {
    const owner = await account();
    await query("DELETE FROM accounts WHERE id = $1", [owner]);
    expect(await defaults(owner)).toEqual([]);
  });

  it("the migration's backfill gives an existing account one, and moves its orphan files into it", async () => {
    const owner = await account("en");
    const d = await doc(owner);
    // an account as it was before the feature (no library, no collection, a file with no place), made inside one transaction with the
    // triggers off for it alone — no change to the schema, so the other tests are not touched
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("UPDATE documents SET collection_id = NULL, folder_id = NULL WHERE id = $1", [d]);
      await client.query("DELETE FROM collections WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM libraries WHERE owner_id = $1", [owner]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await defaults(owner)).toEqual([]);
    await query(BACKFILL_DEFAULT_COLLECTIONS);
    const [home] = await defaults(owner);
    expect(home?.name).toBe("My documents");
    expect(await collectionOf(d)).toBe(home!.id);
    await query(BACKFILL_DEFAULT_COLLECTIONS);
    expect(await defaults(owner)).toHaveLength(1);
  });

  it("is in the overview, flagged, so the page can say which one it is", async () => {
    const owner = await account();
    const overview = await org.overview(query, owner);
    expect(overview[0]?.collections).toEqual([expect.objectContaining({ name: "Mes documents", isDefault: true })]);
  });
});
