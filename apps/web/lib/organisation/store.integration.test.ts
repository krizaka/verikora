import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { KIND, OWNER_ROLE } from "../workspace/decl";
import { seedWorkspace, workspaceFor } from "../workspace/service";
import * as org from "./store";

/** The organisation against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL, like billing.integration.test.ts). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("organisation (ADR-0007)", () => {
  beforeAll(async () => {
    await migrate();
    // A document's tags are the workspace's: its configuration is seeded at boot (instrumentation), so a test that tags seeds it too.
    await seedWorkspace({ now: () => new Date() });
  });
  const account = async () =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`o-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!.id;
  const doc = async (owner: string) =>
    (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, 't', 'f.txt', 'text/plain', 1, $2, 'x') RETURNING id",
        [owner, Math.random().toString(36)],
      )
    )[0]!.id;
  const where = async (id: string) =>
    (
      await query<{ collection_id: string | null; folder_id: string | null }>(
        "SELECT collection_id, folder_id FROM documents WHERE id = $1",
        [id],
      )
    )[0]!;

  it("gives every owner one default library, once", async () => {
    const owner = await account();
    const a = await org.ensureLibrary(query, owner, "Ma bibliothèque");
    const b = await org.ensureLibrary(query, owner, "Ma bibliothèque");
    expect(a.id).toBe(b.id);
  });

  it("shows each collection's latest finished check by completion time, isolated by collection and owner", async () => {
    const owner = await account();
    const stranger = await account();
    const library = await org.ensureLibrary(query, owner, "Checks");
    const otherLibrary = await org.ensureLibrary(query, stranger, "Other checks");
    const empty = await org.createCollection(query, owner, library.id, "Empty");
    const checked = await org.createCollection(query, owner, library.id, "Checked");
    const attention = await org.createCollection(query, owner, library.id, "Attention");
    const failed = await org.createCollection(query, owner, library.id, "Failed");
    const outOfOrder = await org.createCollection(query, owner, library.id, "Out of order");
    const other = await org.createCollection(query, stranger, otherLibrary.id, "Other owner");
    const documentIn = async (accountId: string, collectionId: string) => {
      const id = await doc(accountId);
      await org.placeDocument(query, accountId, id, { collectionId, folderId: null });
      return id;
    };
    const addAnalysis = (
      documentId: string,
      status: "running" | "succeeded" | "failed",
      createdAt: string,
      finishedAt: string | null,
      report: object | null = null,
    ) =>
      query(
        "INSERT INTO analyses (document_id, studio, status, run_id, report, created_at, finished_at) VALUES ($1, 'compliance-check', $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)",
        [
          documentId,
          status,
          `run-${Math.random().toString(36).slice(2)}`,
          report === null ? null : JSON.stringify(report),
          createdAt,
          finishedAt,
        ],
      );

    const checkedDocument = await documentIn(owner, checked.id);
    await addAnalysis(checkedDocument, "succeeded", "2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z", {
      attention: false,
    });
    await addAnalysis(checkedDocument, "running", "2026-10-03T10:00:00Z", null);

    const attentionDocument = await documentIn(owner, attention.id);
    await addAnalysis(attentionDocument, "succeeded", "2026-10-01T10:00:00Z", "2026-10-04T10:00:00Z", {
      attention: true,
    });

    const failedDocument = await documentIn(owner, failed.id);
    await addAnalysis(failedDocument, "failed", "2026-10-05T10:00:00Z", null);

    const outOfOrderDocument = await documentIn(owner, outOfOrder.id);
    await addAnalysis(outOfOrderDocument, "failed", "2026-10-10T10:00:00Z", "2026-10-20T10:00:00Z");
    await addAnalysis(outOfOrderDocument, "succeeded", "2026-10-11T10:00:00Z", "2026-10-15T10:00:00Z", {
      attention: false,
    });

    const otherDocument = await documentIn(stranger, other.id);
    await addAnalysis(otherDocument, "succeeded", "2026-10-01T10:00:00Z", "2026-10-30T10:00:00Z", { attention: true });

    const ownerCollections = (await org.overview(query, owner))[0]!.collections;
    const lastCheck = (id: string) => ownerCollections.find((collection) => collection.id === id)!.lastCheck;
    expect(lastCheck(empty.id)).toBeNull();
    expect(lastCheck(checked.id)).toEqual({ at: "2026-10-02T10:00:00.000Z", status: "checked" });
    expect(lastCheck(attention.id)).toEqual({ at: "2026-10-04T10:00:00.000Z", status: "attention" });
    expect(lastCheck(failed.id)).toEqual({ at: "2026-10-05T10:00:00.000Z", status: "failed" });
    expect(lastCheck(outOfOrder.id)).toEqual({ at: "2026-10-20T10:00:00.000Z", status: "failed" });
    expect(ownerCollections.some((collection) => collection.id === other.id)).toBe(false);
  });

  it("places a document in a collection or a folder of the same collection, never a foreign one", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    const c1 = await org.createCollection(query, owner, lib.id, "Baux");
    const c2 = await org.createCollection(query, owner, lib.id, "Factures");
    const f = await org.createFolder(query, owner, c1.id, "2026");
    const d = await doc(owner);
    await org.placeDocument(query, owner, d, { collectionId: c1.id, folderId: f.id });
    expect(await where(d)).toEqual({ collection_id: c1.id, folder_id: f.id });
    await expect(org.placeDocument(query, owner, d, { collectionId: c2.id, folderId: f.id })).rejects.toMatchObject({
      status: 400,
    });
    await org.placeDocument(query, owner, d, { collectionId: null, folderId: null });
    expect(await where(d)).toEqual({ collection_id: await org.defaultCollectionId(query, owner), folder_id: null });
    const stranger = await account();
    await expect(org.placeDocument(query, stranger, d, { collectionId: c1.id, folderId: null })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses a duplicate name in the same place", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    await org.createCollection(query, owner, lib.id, "Baux");
    await expect(org.createCollection(query, owner, lib.id, "Baux")).rejects.toMatchObject({
      status: 409,
      body: { code: "NAME_TAKEN" },
    });
  });

  it("deleting a folder asks: move the files up to the collection, or delete them", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    const c = await org.createCollection(query, owner, lib.id, "C");
    const f1 = await org.createFolder(query, owner, c.id, "a");
    const f2 = await org.createFolder(query, owner, c.id, "b");
    const d1 = await doc(owner);
    const d2 = await doc(owner);
    await org.placeDocument(query, owner, d1, { collectionId: c.id, folderId: f1.id });
    await org.placeDocument(query, owner, d2, { collectionId: c.id, folderId: f2.id });
    await org.deleteFolder(query, owner, f1.id, { files: "move", to: null });
    expect(await where(d1)).toEqual({ collection_id: c.id, folder_id: null });
    await org.deleteFolder(query, owner, f2.id, { files: "delete" });
    expect(await query("SELECT 1 FROM documents WHERE id = $1", [d2])).toHaveLength(0);
  });

  it("deleting a collection moves its files to another collection or to the default collection, or deletes them", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    const c1 = await org.createCollection(query, owner, lib.id, "one");
    const c2 = await org.createCollection(query, owner, lib.id, "two");
    const c3 = await org.createCollection(query, owner, lib.id, "three");
    const f = await org.createFolder(query, owner, c1.id, "f");
    const d1 = await doc(owner);
    const d2 = await doc(owner);
    await org.placeDocument(query, owner, d1, { collectionId: c1.id, folderId: f.id });
    await org.placeDocument(query, owner, d2, { collectionId: c3.id, folderId: null });
    await org.deleteCollection(query, owner, c1.id, { files: "move", to: c2.id });
    expect(await where(d1)).toEqual({ collection_id: c2.id, folder_id: null });
    await org.deleteCollection(query, owner, c3.id, { files: "move", to: null });
    expect(await where(d2)).toEqual({ collection_id: await org.defaultCollectionId(query, owner), folder_id: null });
    await org.deleteCollection(query, owner, c2.id, { files: "delete" });
    expect(await query("SELECT 1 FROM documents WHERE id = $1", [d1])).toHaveLength(0);
  });

  it("moving a folder takes its files along", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    const c1 = await org.createCollection(query, owner, lib.id, "one");
    const c2 = await org.createCollection(query, owner, lib.id, "two");
    const f = await org.createFolder(query, owner, c1.id, "f");
    const d = await doc(owner);
    await org.placeDocument(query, owner, d, { collectionId: c1.id, folderId: f.id });
    await org.moveFolder(query, owner, f.id, c2.id);
    expect(await where(d)).toEqual({ collection_id: c2.id, folder_id: f.id });
  });

  it("tags: per owner, unique by name, many to many, and the filter needs all of them (a document's tags are the workspace's, a collection's the first layer's)", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    const c = await org.createCollection(query, owner, lib.id, "C");
    const done = await org.createTag(query, owner, "Fait", "green");
    await expect(org.createTag(query, owner, "fait", "blue")).rejects.toMatchObject({ status: 409 });
    const w = workspaceFor({ clock: { now: () => new Date() } });
    const actor = { id: owner, label: "eric@verikora.test", role: OWNER_ROLE };
    const urgent = await w.tags.create(owner, actor, KIND.document, { name: "Urgent", marker: "red" });
    const fait = await w.tags.create(owner, actor, KIND.document, { name: "Fait", marker: "green" });
    await expect(w.tags.create(owner, actor, KIND.document, { name: "urgent", marker: "blue" })).rejects.toMatchObject({
      code: "NAME_TAKEN",
    });
    const d1 = await doc(owner);
    const d2 = await doc(owner);
    await org.placeDocument(query, owner, d1, { collectionId: c.id, folderId: null });
    await org.placeDocument(query, owner, d2, { collectionId: c.id, folderId: null });
    await w.tags.set(owner, actor, KIND.document, d1, [urgent.id, fait.id]);
    await w.tags.set(owner, actor, KIND.document, d2, [urgent.id]);
    await org.setTags(query, owner, { kind: "collection", id: c.id }, [done.id]);
    expect((await org.browse(query, owner, { collectionId: c.id, tagIds: [urgent.id] })).documentIds.sort()).toEqual(
      [d1, d2].sort(),
    );
    expect((await org.browse(query, owner, { collectionId: c.id, tagIds: [urgent.id, fait.id] })).documentIds).toEqual([
      d1,
    ]);
    expect(
      (await w.tags.of(owner, KIND.document, [d1, d2]))
        .get(d1)
        ?.map((t) => t.name)
        .sort(),
    ).toEqual(["Fait", "Urgent"]);
    const other = await account();
    await expect(org.setTags(query, other, { kind: "collection", id: c.id }, [done.id])).rejects.toMatchObject({
      status: 404,
    });
    await w.tags.remove(owner, actor, KIND.document, urgent.id);
    expect((await org.browse(query, owner, { collectionId: c.id, tagIds: [] })).documentIds.sort()).toEqual(
      [d1, d2].sort(),
    );
  });

  it("browse: a collection root shows the files not in a folder, a folder shows its own; a loose file is in the default collection", async () => {
    const owner = await account();
    const lib = await org.ensureLibrary(query, owner, "L");
    const c = await org.createCollection(query, owner, lib.id, "C");
    const f = await org.createFolder(query, owner, c.id, "f");
    const root = await doc(owner);
    const inFolder = await doc(owner);
    const loose = await doc(owner);
    await org.placeDocument(query, owner, root, { collectionId: c.id, folderId: null });
    await org.placeDocument(query, owner, inFolder, { collectionId: c.id, folderId: f.id });
    expect((await org.browse(query, owner, { collectionId: c.id, tagIds: [] })).documentIds).toEqual([root]);
    expect((await org.browse(query, owner, { collectionId: c.id, folderId: f.id, tagIds: [] })).documentIds).toEqual([
      inFolder,
    ]);
    expect(
      (await org.browse(query, owner, { collectionId: await org.defaultCollectionId(query, owner), tagIds: [] }))
        .documentIds,
    ).toEqual([loose]);
    expect((await org.recentIds(query, owner, 10)).sort()).toEqual([root, inFolder, loose].sort());
  });

  it("says where a document sits — its library and collection, for the way back — its default collection for a document not placed by hand, and nothing for another owner's document", async () => {
    const owner = await account();
    const stranger = await account();
    const library = await org.ensureLibrary(query, owner, "Immeubles");
    const c = await org.createCollection(query, owner, library.id, "4½ Villeray");
    const placed = await doc(owner);
    await org.placeDocument(query, owner, placed, { collectionId: c.id, folderId: null });
    expect(await org.placeOf(query, owner, placed)).toEqual({
      libraryId: library.id,
      collectionId: c.id,
      name: "4½ Villeray",
      isDefault: false,
    });
    expect(await org.placeOf(query, stranger, placed)).toBeNull();
    expect(await org.placeOf(query, owner, await doc(owner))).toMatchObject({ isDefault: true });
  });
});
