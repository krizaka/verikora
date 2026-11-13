import { filterSql } from "@krizaka/organize";
import type { CollectionAvatar } from "@verikora/core";
import type { QueryResultRow } from "pg";

import { refuse } from "../http";
import { KIND, WORKSPACE } from "../workspace/decl";
import { guard, organizeOver } from "./organize";
import { cleanName, type DeleteChoice, isId, type TagColor } from "./rules";

/**
 * The organisation's storage (ADR-0007): libraries, collections, folders (one level), tags and where a document sits.
 * It takes its `query` as a parameter (tested against a real PostgreSQL) and knows nothing of the checks: it hands out
 * document ids, the documents module turns them into summaries.
 */
export type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

export interface Library {
  id: string;
  name: string;
}
export interface Collection {
  id: string;
  library_id: string;
  name: string;
  is_default: boolean;
  avatar: CollectionAvatar | null;
  description: string | null;
}
export interface Folder {
  id: string;
  collection_id: string;
  name: string;
}
export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}
export type TagTarget = "collection" | "folder";

const notFound = (what: string) => refuse(404, "NOT_FOUND", `No such ${what}`);
const taken = () => refuse(409, "NAME_TAKEN", "That name is already used here");

/** A unique violation becomes the stable 409 the client translates. */
async function unique<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw taken();
    throw error;
  }
}

const one = async <T>(rows: Promise<T[]>, what: string): Promise<T> => {
  const [row] = await rows;
  if (!row) throw notFound(what);
  return row;
};

// ── libraries ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The owner's default library, created on first use. */
export async function ensureLibrary(q: Query, owner: string, name: string): Promise<Library> {
  const label = cleanName(name);
  const [found] = await q<Library>("SELECT id, name FROM libraries WHERE owner_id = $1 ORDER BY created_at LIMIT 1", [
    owner,
  ]);
  if (found) return found;
  const [row] = await q<Library>(
    "INSERT INTO libraries (owner_id, name) VALUES ($1, $2) ON CONFLICT (owner_id, name) DO UPDATE SET name = excluded.name RETURNING id, name",
    [owner, label],
  );
  return row!;
}

export const createLibrary = (q: Query, owner: string, name: string) =>
  unique(
    async () =>
      (
        await q<Library>("INSERT INTO libraries (owner_id, name) VALUES ($1, $2) RETURNING id, name", [
          owner,
          cleanName(name),
        ])
      )[0]!,
  );
export const renameLibrary = (q: Query, owner: string, id: string, name: string) =>
  unique(() =>
    one(
      q<Library>("UPDATE libraries SET name = $3 WHERE owner_id = $1 AND id = $2 RETURNING id, name", [
        owner,
        id,
        cleanName(name),
      ]),
      "library",
    ),
  );

/**
 * Only an empty library can be deleted (and never the last one). The owner check comes first: another account's library is a 404
 * like an absent one, never a 409 that says it exists and what it holds (krizaka-internal#2383).
 */
export async function deleteLibrary(q: Query, owner: string, id: string): Promise<void> {
  await owned(q, "library", owner, id);
  const [lib] = await q<{ n: string; c: string }>(
    "SELECT (SELECT count(*) FROM libraries WHERE owner_id = $1) AS n, (SELECT count(*) FROM collections WHERE library_id = $2) AS c",
    [owner, id],
  );
  if (Number(lib?.n) <= 1) throw refuse(409, "LAST_LIBRARY", "The last library cannot be deleted");
  const [holdsDefault] = await q("SELECT 1 FROM collections WHERE library_id = $1 AND is_default", [id]);
  if (holdsDefault)
    throw refuse(
      409,
      "DEFAULT_COLLECTION",
      "This library holds the default collection: make another collection the default first",
    );
  if (Number(lib?.c) > 0) throw refuse(409, "NOT_EMPTY", "Move or delete its collections first");
  await one(q("DELETE FROM libraries WHERE owner_id = $1 AND id = $2 RETURNING id", [owner, id]), "library");
}

export interface LibraryOverview extends Library {
  collections: {
    id: string;
    name: string;
    files: number;
    folders: number;
    tags: Tag[];
    isDefault: boolean;
    avatar: CollectionAvatar | null;
    description: string | null;
    lastCheck: LastCheck | null;
  }[];
}

/** The latest finished check of a collection's files: when, and its result (the document status vocabulary). */
export interface LastCheck {
  at: string;
  status: "checked" | "attention" | "failed";
}

/** Every library of the owner with its collections, file counts and tags. */
export async function overview(q: Query, owner: string): Promise<LibraryOverview[]> {
  const libs = await q<Library>("SELECT id, name FROM libraries WHERE owner_id = $1 ORDER BY created_at", [owner]);
  const cols = await q<{
    id: string;
    library_id: string;
    name: string;
    is_default: boolean;
    avatar: CollectionAvatar | null;
    description: string | null;
    files: string;
    folders: string;
    last_at: Date | string | null;
    last_status: LastCheck["status"] | null;
  }>(
    `SELECT c.id, c.library_id, c.name, c.is_default, c.avatar, c.description,
            (SELECT count(*) FROM documents d WHERE d.collection_id = c.id) AS files,
            (SELECT count(*) FROM folders f WHERE f.collection_id = c.id) AS folders,
            coalesce(la.finished_at, la.created_at) AS last_at,
            CASE WHEN la.status = 'failed' THEN 'failed' WHEN coalesce((la.report->>'attention')::boolean, false) THEN 'attention' WHEN la.id IS NOT NULL THEN 'checked' END AS last_status
       FROM collections c JOIN libraries l ON l.id = c.library_id
       LEFT JOIN LATERAL (SELECT a.id, a.status, a.report, a.created_at, a.finished_at FROM analyses a JOIN documents d ON d.id = a.document_id
                           WHERE d.collection_id = c.id AND a.status IN ('succeeded', 'failed') ORDER BY coalesce(a.finished_at, a.created_at) DESC LIMIT 1) la ON true
      WHERE l.owner_id = $1 ORDER BY lower(c.name)`,
    [owner],
  );
  const tags = await tagsOf(
    q,
    owner,
    "collection",
    cols.map((c) => c.id),
  );
  return libs.map((l) => ({
    ...l,
    collections: cols
      .filter((c) => c.library_id === l.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        files: Number(c.files),
        folders: Number(c.folders),
        tags: tags.get(c.id) ?? [],
        isDefault: c.is_default,
        avatar: c.avatar,
        description: c.description,
        lastCheck: c.last_at && c.last_status ? { at: new Date(c.last_at).toISOString(), status: c.last_status } : null,
      })),
  }));
}

// ── what an owner owns, and the containers one level down ─────────────────────────────────────────────────────────────

/** What can be owned, how to find it for its owner, and what it is called in an error. */
const OWNED = {
  library: { sql: "SELECT id, name FROM libraries WHERE owner_id = $1 AND id = $2" },
  collection: {
    sql: "SELECT c.id, c.library_id, c.name, c.is_default, c.avatar, c.description FROM collections c WHERE c.owner_id = $1 AND c.id = $2",
  },
  folder: {
    sql: "SELECT f.id, f.collection_id, f.name FROM folders f JOIN collections c ON c.id = f.collection_id JOIN libraries l ON l.id = c.library_id WHERE l.owner_id = $1 AND f.id = $2",
  },
  document: { sql: "SELECT id FROM documents WHERE owner_id = $1 AND id = $2" },
} as const;

interface Owned {
  library: Library;
  collection: Collection;
  folder: Folder;
  document: { id: string };
}

async function owned<K extends keyof Owned>(q: Query, kind: K, owner: string, id: string): Promise<Owned[K]> {
  if (!isId(id)) throw notFound(kind);
  return one(q<Owned[K] & QueryResultRow>(OWNED[kind].sql, [owner, id]), kind);
}

export const ownedCollection = (q: Query, owner: string, id: string) => owned(q, "collection", owner, id);
export const ownedFolder = (q: Query, owner: string, id: string) => owned(q, "folder", owner, id);

/** A collection lives in a library, a folder in a collection: the same create, rename and move, by table. */
const CHILD = {
  collection: {
    table: "collections",
    parentColumn: "library_id",
    parent: "library",
    columns: "id, library_id, name, is_default, avatar, description",
  },
  folder: { table: "folders", parentColumn: "collection_id", parent: "collection", columns: "id, collection_id, name" },
} as const;
type ChildKind = keyof typeof CHILD;

async function createChild<K extends ChildKind>(
  q: Query,
  kind: K,
  owner: string,
  parentId: string,
  name: string,
): Promise<Owned[K]> {
  const { table, parentColumn, parent, columns } = CHILD[kind];
  await owned(q, parent, owner, parentId);
  return unique(
    async () =>
      (
        await q<Owned[K] & QueryResultRow>(
          `INSERT INTO ${table} (${parentColumn}, name) VALUES ($1, $2) RETURNING ${columns}`,
          [parentId, cleanName(name)],
        )
      )[0]!,
  );
}

async function renameChild<K extends ChildKind>(
  q: Query,
  kind: K,
  owner: string,
  id: string,
  name: string,
): Promise<Owned[K]> {
  await owned(q, kind, owner, id);
  return unique(
    async () =>
      (
        await q<Owned[K] & QueryResultRow>(
          `UPDATE ${CHILD[kind].table} SET name = $2 WHERE id = $1 RETURNING ${CHILD[kind].columns}`,
          [id, cleanName(name)],
        )
      )[0]!,
  );
}

async function moveChild<K extends ChildKind>(
  q: Query,
  kind: K,
  owner: string,
  id: string,
  parentId: string,
): Promise<Owned[K]> {
  const { table, parentColumn, parent, columns } = CHILD[kind];
  await owned(q, kind, owner, id);
  await owned(q, parent, owner, parentId);
  return unique(
    async () =>
      (
        await q<Owned[K] & QueryResultRow>(
          `UPDATE ${table} SET ${parentColumn} = $2 WHERE id = $1 RETURNING ${columns}`,
          [id, parentId],
        )
      )[0]!,
  );
}

export const createCollection = (q: Query, owner: string, libraryId: string, name: string) =>
  createChild(q, "collection", owner, libraryId, name);
export const renameCollection = (q: Query, owner: string, id: string, name: string) =>
  renameChild(q, "collection", owner, id, name);
export const moveCollection = (q: Query, owner: string, id: string, libraryId: string) =>
  moveChild(q, "collection", owner, id, libraryId);
export const createFolder = (q: Query, owner: string, collectionId: string, name: string) =>
  createChild(q, "folder", owner, collectionId, name);
export const renameFolder = (q: Query, owner: string, id: string, name: string) =>
  renameChild(q, "folder", owner, id, name);

/** Moves a folder to another collection of the owner; its files follow. */
export async function moveFolder(q: Query, owner: string, id: string, collectionId: string): Promise<Folder> {
  const moved = await moveChild(q, "folder", owner, id, collectionId);
  await q("UPDATE documents SET collection_id = $2 WHERE folder_id = $1", [id, collectionId]);
  return moved;
}

/** The owner's default collection: where a file goes when nothing else is said. */
export const defaultCollectionId = (q: Query, owner: string): Promise<string> =>
  guard(() => organizeOver(q).collections.defaultId(owner));

/** Makes another collection the owner's default: one statement, so there is always exactly one. */
export const setDefaultCollection = (q: Query, owner: string, id: string): Promise<void> =>
  guard(() => organizeOver(q).collections.setDefault(owner, id));

/** Deletes a collection after saying what becomes of its files (and its folders go with it): moved to another collection (the default one when none is named), or deleted. The default collection is never deleted. */
export async function deleteCollection(q: Query, owner: string, id: string, choice: DeleteChoice): Promise<void> {
  const collection = await ownedCollection(q, owner, id);
  if (collection.is_default)
    throw refuse(
      409,
      "DEFAULT_COLLECTION",
      "The default collection cannot be deleted: make another one the default first",
    );
  if (choice.files === "delete")
    await q("DELETE FROM documents WHERE owner_id = $1 AND collection_id = $2", [owner, id]);
  else {
    if (choice.to === id) throw refuse(400, "BAD_REQUEST", "Choose another destination");
    const to =
      choice.to === null ? await defaultCollectionId(q, owner) : (await ownedCollection(q, owner, choice.to)).id;
    await q("UPDATE documents SET collection_id = $3, folder_id = NULL WHERE owner_id = $1 AND collection_id = $2", [
      owner,
      id,
      to,
    ]);
  }
  await q("DELETE FROM collections WHERE id = $1", [id]);
}

/** Deletes a folder after saying what becomes of its files: moved up to its collection, or deleted. */
export async function deleteFolder(q: Query, owner: string, id: string, choice: DeleteChoice): Promise<void> {
  const folder = await ownedFolder(q, owner, id);
  if (choice.files === "delete") await q("DELETE FROM documents WHERE owner_id = $1 AND folder_id = $2", [owner, id]);
  else {
    if (choice.to !== null) {
      const target = await ownedFolder(q, owner, choice.to);
      if (target.collection_id !== folder.collection_id || target.id === id)
        throw refuse(400, "BAD_REQUEST", "Choose a folder of the same collection");
    }
    await q("UPDATE documents SET folder_id = $3 WHERE owner_id = $1 AND folder_id = $2", [owner, id, choice.to]);
  }
  await q("DELETE FROM folders WHERE id = $1", [id]);
}

// ── where a document sits ─────────────────────────────────────────────────────────────────────────────────────────────

export interface Placement {
  collectionId: string | null;
  folderId: string | null;
}

/** Places a document in a collection, or a folder of that collection; both null = the owner's default collection. */
export async function placeDocument(q: Query, owner: string, documentId: string, to: Placement): Promise<void> {
  await owned(q, "document", owner, documentId);
  if (to.folderId && !to.collectionId) throw refuse(400, "BAD_REQUEST", "A folder belongs to a collection");
  if (to.collectionId) await ownedCollection(q, owner, to.collectionId);
  if (to.folderId) {
    const folder = await ownedFolder(q, owner, to.folderId);
    if (folder.collection_id !== to.collectionId)
      throw refuse(400, "BAD_REQUEST", "That folder is in another collection");
  }
  await q("UPDATE documents SET collection_id = $2, folder_id = $3 WHERE id = $1", [
    documentId,
    to.collectionId ?? (await defaultCollectionId(q, owner)),
    to.folderId,
  ]);
}

// ── tags (the package's) ──────────────────────────────────────────────────────────────────────────────────────────────

export const listTags = (q: Query, owner: string) => guard(() => organizeOver(q).tags.list(owner));
export const createTag = (q: Query, owner: string, name: string, color: TagColor) =>
  guard(() => organizeOver(q).tags.create(owner, { name, color }));
export const updateTag = (
  q: Query,
  owner: string,
  id: string,
  patch: { name?: string; color?: TagColor },
): Promise<Tag> => guard(() => organizeOver(q).tags.update(owner, id, patch));
export const deleteTag = (q: Query, owner: string, id: string): Promise<void> =>
  guard(() => organizeOver(q).tags.remove(owner, id));
/** Replaces the tags of a collection or a folder (all of them must be the owner's). The documents' tags are the workspace's. */
export const setTags = (
  q: Query,
  owner: string,
  target: { kind: TagTarget; id: string },
  tagIds: string[],
): Promise<void> => guard(() => organizeOver(q).tags.assign(owner, target.kind, target.id, tagIds));
/** The tags of many targets at once, by target id. */
export const tagsOf = (q: Query, owner: string, kind: TagTarget, ids: string[]): Promise<Map<string, Tag[]>> =>
  guard(() => organizeOver(q).tags.of(owner, kind, ids));

// ── reading a place ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a document sits, for the way back from its page: its library and collection (the default one unless placed by hand) — null for another owner's document. */
export async function placeOf(
  q: Query,
  owner: string,
  documentId: string,
): Promise<{ libraryId: string; collectionId: string; name: string; isDefault: boolean } | null> {
  const [row] = await q<{ library_id: string; collection_id: string; name: string; is_default: boolean }>(
    "SELECT c.library_id, c.id AS collection_id, c.name, c.is_default FROM documents d JOIN collections c ON c.id = d.collection_id WHERE d.owner_id = $1 AND d.id = $2",
    [owner, documentId],
  );
  return row
    ? { libraryId: row.library_id, collectionId: row.collection_id, name: row.name, isDefault: row.is_default }
    : null;
}

/** The files of a collection (its root, or one of its folders), newest first, matching ALL the selected tags (the workspace layer's filter, verikora#324). */
export async function browse(
  q: Query,
  owner: string,
  where: { collectionId: string; folderId?: string; tagIds: string[] },
): Promise<{ documentIds: string[] }> {
  const filter = filterSql(WORKSPACE, KIND.document, { tags: where.tagIds }, { from: 4 });
  const rows = await q<{ id: string }>(
    `SELECT e.id FROM documents e WHERE e.owner_id = $1 AND e.collection_id = $2 AND e.folder_id IS NOT DISTINCT FROM $3${filter.sql} ORDER BY e.created_at DESC LIMIT 500`,
    [owner, where.collectionId, where.folderId ?? null, ...filter.params],
  );
  return { documentIds: rows.map((r) => r.id) };
}

export async function foldersOf(
  q: Query,
  owner: string,
  collectionId: string,
): Promise<(Folder & { files: number; tags: Tag[] })[]> {
  await ownedCollection(q, owner, collectionId);
  const rows = await q<Folder & { files: string }>(
    "SELECT f.id, f.collection_id, f.name, (SELECT count(*) FROM documents d WHERE d.folder_id = f.id) AS files FROM folders f WHERE f.collection_id = $1 ORDER BY lower(f.name)",
    [collectionId],
  );
  const tags = await tagsOf(
    q,
    owner,
    "folder",
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, files: Number(r.files), tags: tags.get(r.id) ?? [] }));
}

export async function recentIds(q: Query, owner: string, limit: number): Promise<string[]> {
  return (
    await q<{ id: string }>("SELECT id FROM documents WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2", [
      owner,
      limit,
    ])
  ).map((r) => r.id);
}

/** A collection's description (at most 500 characters; empty or `null` clears it). */
export const describeCollection = (q: Query, owner: string, id: string, text: string | null) =>
  guard(() => organizeOver(q).collections.describe(owner, id, text));
