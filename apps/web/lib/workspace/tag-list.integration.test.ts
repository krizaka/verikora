import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as tagsRoute } from "@/app/api/organize/[kind]/tags/route";
import { PUT as setRoute } from "@/app/api/organize/[kind]/tags/set/route";
import { PUT as assignRoute } from "@/app/api/tags/assign/route";
import { GET as legacyTagsRoute, POST as legacyCreateRoute } from "@/app/api/tags/route";

import { migrate, pool, query } from "../db";
import { resetRateLimits } from "../limits";
import { createCollection, createFolder, ensureLibrary, foldersOf, overview } from "../organisation/store";
import { libraryTags } from "../organisation/tag-list";
import { createSession, SESSION_COOKIE } from "../session";
import { KIND, OWNER_ROLE } from "./decl";
import { seedWorkspace, workspaceFor } from "./service";

/** One tag list for the library (krizaka-internal#3994), against a real PostgreSQL and through the real routes. Demo data only. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

const as = (token: string, method: string, path: string, body?: object) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const at = (kind: string) => ({ params: Promise.resolve({ kind }) });

describe.runIf(enabled)("one tag list for collections, folders and documents (krizaka-internal#3994)", () => {
  const stamp = Date.now();
  const w = workspaceFor({ clock: { now: () => new Date() } });
  let owner = "";
  let other = "";
  let token = "";
  const actorOf = (id: string) => ({ id, label: `${id}@verikora.test`, role: OWNER_ROLE });
  const account = async (who: string) =>
    (
      await query<{ id: string }>("INSERT INTO accounts (email, password_hash) VALUES ($1, 'x') RETURNING id", [
        `${who}-${stamp}@verikora.test`,
      ])
    )[0]!.id;
  const document = async (id: string, collectionId: string) =>
    (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, collection_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 't', 'f.txt', 'text/plain', 1, $3, 'x') RETURNING id",
        [id, collectionId, `${stamp}-${Math.random()}`],
      )
    )[0]!.id;

  beforeAll(async () => {
    await migrate();
    await seedWorkspace({ now: () => new Date() });
    [owner, other] = [await account("owner"), await account("other")];
    token = (await createSession(owner, { ip: "203.0.113.40", userAgent: "vitest" })).token;
  });
  afterAll(async () => {
    await query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[owner, other]]);
    await pool().end();
  });

  it("a tag created on a collection is offered on a document of that account, and the reverse", async () => {
    const onCollection = await w.tags.create(owner, actorOf(owner), KIND.collection, {
      name: "Rosemont",
      marker: "red",
    });
    const onDocument = await w.tags.create(owner, actorOf(owner), KIND.document, { name: "Urgent", marker: "amber" });
    const forDocuments = (await w.tags.list(owner, KIND.document)).map((t) => t.name);
    expect(forDocuments).toEqual(expect.arrayContaining(["Rosemont", "Urgent"]));
    const forCollections = (await w.tags.list(owner, KIND.collection)).map((t) => t.id);
    expect(forCollections).toEqual(expect.arrayContaining([onCollection.id, onDocument.id]));
    expect((await w.tags.list(owner, KIND.folder)).map((t) => t.id)).toEqual(forCollections);
    // …and it stays the account's own: the other account sees none of them, and may use the same names.
    expect(await w.tags.list(other, KIND.document)).toEqual([]);
    await expect(
      w.tags.create(owner, actorOf(owner), KIND.folder, { name: "rosemont", marker: "blue" }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("a collection, a folder and a document wear tags of the same list; a rename and a delete reach all three", async () => {
    const lib = await ensureLibrary(query, owner, "L");
    const collection = await createCollection(query, owner, lib.id, `C-${stamp}`);
    const folder = await createFolder(query, owner, collection.id, `F-${stamp}`);
    const doc = await document(owner, collection.id);
    const shared = await w.tags.create(owner, actorOf(owner), KIND.document, {
      name: `Partagée ${stamp}`,
      marker: "violet",
    });
    await w.tags.set(owner, actorOf(owner), KIND.collection, collection.id, [shared.id]);
    await w.tags.set(owner, actorOf(owner), KIND.folder, folder.id, [shared.id]);
    await w.tags.set(owner, actorOf(owner), KIND.document, doc, [shared.id]);
    await w.tags.update(owner, actorOf(owner), KIND.collection, shared.id, {
      name: `Renommée ${stamp}`,
      marker: "green",
    });
    const seen = async () => [
      (await w.tags.of(owner, KIND.collection, [collection.id])).get(collection.id)?.[0],
      (await w.tags.of(owner, KIND.folder, [folder.id])).get(folder.id)?.[0],
      (await w.tags.of(owner, KIND.document, [doc])).get(doc)?.[0],
    ];
    for (const tag of await seen()) {
      expect(tag).toMatchObject({ name: `Renommée ${stamp}`, marker: "green" });
    }
    // The screens' reads (overview, folders) see the same tag.
    const shown = (await overview(query, owner)).flatMap((l) => l.collections).find((c) => c.id === collection.id);
    expect(shown?.tags).toEqual([{ id: shared.id, name: `Renommée ${stamp}`, color: "green" }]);
    expect((await foldersOf(query, owner, collection.id))[0]?.tags.map((t) => t.id)).toEqual([shared.id]);
    // A tag of another account is refused on a collection.
    await expect(w.tags.set(other, actorOf(other), KIND.collection, collection.id, [shared.id])).rejects.toMatchObject({
      status: 404,
    });
    await w.tags.remove(owner, actorOf(owner), KIND.document, shared.id);
    for (const tag of await seen()) {
      expect(tag).toBeUndefined();
    }
  });

  it("/api/tags (kept for one release) and /api/organize/document/tags answer the same rows, through each one's writes", async () => {
    resetRateLimits();
    const created = await legacyCreateRoute(as(token, "POST", "/api/tags", { name: `Vieux ${stamp}`, color: "gray" }));
    expect(created.status).toBe(201);
    const { tag } = (await created.json()) as { tag: { id: string; name: string; color: string } };
    expect(tag).toMatchObject({ name: `Vieux ${stamp}`, color: "gray" });
    const old = (await (await legacyTagsRoute(as(token, "GET", "/api/tags"))).json()) as {
      tags: { id: string; name: string; color: string }[];
    };
    const current = (await (
      await tagsRoute(as(token, "GET", "/api/organize/document/tags"), at("document"))
    ).json()) as {
      tags: { id: string; name: string; marker: string }[];
    };
    expect(old.tags.map(({ id, name, color }) => ({ id, name, marker: color }))).toEqual(
      current.tags.map(({ id, name, marker }) => ({ id, name, marker })),
    );
    expect(old.tags.map((t) => t.id)).toContain(tag.id);
    expect((await libraryTags(query, owner)).map((t) => t.id)).toEqual(old.tags.map((t) => t.id));
    // The old assign route and the new set route write the same links.
    const lib = await ensureLibrary(query, owner, "L2");
    const collection = await createCollection(query, owner, lib.id, `C2-${stamp}`);
    const assigned = await assignRoute(
      as(token, "PUT", "/api/tags/assign", { kind: "collection", id: collection.id, tagIds: [tag.id] }),
    );
    expect(assigned.status).toBe(200);
    expect((await w.tags.of(owner, KIND.collection, [collection.id])).get(collection.id)?.map((t) => t.id)).toEqual([
      tag.id,
    ]);
    const cleared = await setRoute(
      as(token, "PUT", "/api/organize/collection/tags/set", { id: collection.id, tagIds: [] }),
      at("collection"),
    );
    expect(cleared.status).toBe(200);
    expect((await w.tags.of(owner, KIND.collection, [collection.id])).get(collection.id) ?? []).toEqual([]);
  });
});
