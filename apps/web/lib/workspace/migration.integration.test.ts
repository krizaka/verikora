import { assertModules, migrate as runMigrations } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { MIGRATION_LOCK_KEY } from "../db";
import { withScratchDatabase } from "../migration-testkit";
import { MIGRATIONS } from "../migrations";
import { MODULES } from "../modules";
import { TAG_LIST_COPY_SQL } from "./migration";

/** Migration 0010 (krizaka-internal#3994) on a real database, with the dev cast only: two accounts, both tag systems, run twice. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const VERSION = "0010_one_tag_list";
const before = MIGRATIONS.filter((m) => m.version < VERSION);
const only = MIGRATIONS.filter((m) => m.version === VERSION);

describe.runIf(enabled)("the migration of the three tag lists into one (krizaka-internal#3994)", () => {
  it("merges by lower(name) per account, keeps the document tag's colour, keeps the links, and is idempotent", () =>
    withScratchDatabase("taglist", async (db) => {
      const lock = { lockKey: MIGRATION_LOCK_KEY };
      await runMigrations(db.connect, before, lock);
      const row = async (sql: string, values?: unknown[]) => ((await db.run(sql, values)) as { id: string }[])[0]!.id;
      const [a, b] = [
        await row("INSERT INTO accounts (email) VALUES ('a@verikora.test') RETURNING id"),
        await row("INSERT INTO accounts (email) VALUES ('b@verikora.test') RETURNING id"),
      ];
      const docTag = (owner: string, name: string, marker: string) =>
        row(
          "INSERT INTO organize.tag (scope_id, kind, name, marker, origin, created_at) VALUES ($1, 'document', $2, $3, 'user', now()) RETURNING id",
          [owner, name, marker],
        );
      const oldTag = (owner: string, name: string, color: string) =>
        row("INSERT INTO public.tags (owner_id, name, color) VALUES ($1, $2, $3) RETURNING id", [owner, name, color]);
      const library = (owner: string) =>
        row("INSERT INTO libraries (owner_id, name) VALUES ($1, 'L') RETURNING id", [owner]);
      const collection = async (owner: string, name: string) =>
        row("INSERT INTO collections (owner_id, library_id, name) VALUES ($1, $2, $3) RETURNING id", [
          owner,
          await library(owner),
          name,
        ]);
      // Account A: « Rosemont » in both systems (document: blue, old: red), « montreal » and « qa-urgent » only in the old one.
      const aDocRosemont = await docTag(a, "Rosemont", "blue");
      const aOldRosemont = await oldTag(a, "rosemont", "red");
      const aMontreal = await oldTag(a, "montreal", "gray");
      const aUrgent = await oldTag(a, "qa-urgent", "red");
      // Account B: the same names, its own list, its own colours.
      const bOldRosemont = await oldTag(b, "Rosemont", "green");
      const aColl = await collection(a, "Immeuble Rosemont");
      const bColl = await collection(b, "Immeuble B");
      const aFolder = await row("INSERT INTO folders (collection_id, name) VALUES ($1, 'Baux') RETURNING id", [aColl]);
      for (const [c, t] of [
        [aColl, aOldRosemont],
        [aColl, aMontreal],
        [bColl, bOldRosemont],
      ] as const)
        await db.run("INSERT INTO public.collections_tags (collection_id, tag_id) VALUES ($1, $2)", [c, t]);
      await db.run("INSERT INTO public.folder_tags (folder_id, tag_id) VALUES ($1, $2)", [aFolder, aUrgent]);

      expect(await runMigrations(db.connect, only, lock)).toEqual([VERSION]);

      const lists = async () =>
        (await db.run(
          "SELECT scope_id, name, marker, id FROM organize.tag WHERE kind = 'document' ORDER BY scope_id, lower(name)",
        )) as { scope_id: string; name: string; marker: string; id: string }[];
      const links = async (table: string) =>
        (await db.run(`SELECT entity_id, tag_id FROM organize.${table} ORDER BY entity_id, tag_id`)) as {
          entity_id: string;
          tag_id: string;
        }[];
      const snapshot = async () => ({
        lists: await lists(),
        collections: await links("collection_tag"),
        folders: await links("folder_tag"),
      });

      const first = await snapshot();
      // One list per account: A has 3 names (Rosemont once, with the DOCUMENT tag's colour and id), B has its own.
      const ofA = first.lists.filter((t) => t.scope_id === a);
      expect(ofA.map((t) => [t.name, t.marker])).toEqual([
        ["montreal", "gray"],
        ["qa-urgent", "red"],
        ["Rosemont", "blue"],
      ]);
      expect(ofA.find((t) => t.name === "Rosemont")?.id).toBe(aDocRosemont);
      expect(first.lists.filter((t) => t.scope_id === b).map((t) => [t.name, t.marker])).toEqual([
        ["Rosemont", "green"],
      ]);
      // The links are kept: A's collection wears Rosemont (the document tag) and montreal, A's folder wears qa-urgent, B's collection its own.
      const nameOf = (id: string) => first.lists.find((t) => t.id === id)?.name;
      expect(
        first.collections
          .filter((l) => l.entity_id === aColl)
          .map((l) => nameOf(l.tag_id))
          .sort(),
      ).toEqual(["Rosemont", "montreal"]);
      expect(first.folders.map((l) => [l.entity_id, nameOf(l.tag_id)])).toEqual([[aFolder, "qa-urgent"]]);
      const bLink = first.collections.find((l) => l.entity_id === bColl);
      expect(first.lists.find((t) => t.id === bLink?.tag_id)).toMatchObject({ scope_id: b, marker: "green" });

      // Idempotent: the copy again, and the whole runner again, change nothing.
      await db.run(TAG_LIST_COPY_SQL);
      expect(await runMigrations(db.connect, MIGRATIONS, lock)).toEqual([]);
      expect(await snapshot()).toEqual(first);

      // Expand only: the old tables are untouched, and the application's module check still passes.
      expect(await db.run("SELECT count(*)::int AS n FROM public.tags")).toEqual([{ n: 4 }]);
      expect(await db.run("SELECT count(*)::int AS n FROM public.collections_tags")).toEqual([{ n: 3 }]);
      expect(await db.run("SELECT count(*)::int AS n FROM public.folder_tags")).toEqual([{ n: 1 }]);
      await assertModules(db.run, MODULES);
    }));
});
