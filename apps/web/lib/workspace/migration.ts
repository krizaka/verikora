/**
 * krizaka-internal#3994 (one tag list for collections, folders and documents): the migration 0010, EXPAND only.
 *
 * - The link tables of the two new kinds and their status tables, exactly as `@krizaka/organize` emits them for `WORKSPACE`
 *   (`lib/migrations.test.ts` holds the text to the package), and the module's marker moved to the checksum of the new declaration.
 * - `TAG_LIST_COPY_SQL`: copies `public.tags` into the library list (`organize.tag`, kind « document ») merged by `lower(name)` per
 *   account (a name in both keeps the document tag's colour: the existing row is never touched), then `collections_tags` and
 *   `folder_tags` into `organize.collection_tag` / `organize.folder_tag`. Idempotent: a second run adds no row.
 * - Nothing is deleted: `public.tags`, `collections_tags` and `folder_tags` stay for the follow-up (contract) that drops them.
 */

/** The checksum of `workspaceSchema(WORKSPACE)` v1 (the marker the application checks at start). */
export const WORKSPACE_CHECKSUM = "e40cf6d72bd17fe047745c927aac2229d12ca2e3ad5450acad0006c75fc8f527";

const TAG_NAME = "lower(left(btrim(t.name), 80))";

export const TAG_LIST_COPY_SQL = `
INSERT INTO organize.tag (scope_id, kind, name, marker, origin, created_at)
SELECT t.owner_id, 'document', left(btrim(t.name), 80), t.color, 'user', now()
  FROM public.tags t
 WHERE char_length(btrim(t.name)) >= 1
 ORDER BY t.owner_id, t.id
ON CONFLICT (scope_id, kind, lower(name)) DO NOTHING;
INSERT INTO organize.collection_tag (entity_id, tag_id)
SELECT ct.collection_id, o.id
  FROM public.collections_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  JOIN public.collections c ON c.id = ct.collection_id AND c.owner_id = t.owner_id
  JOIN organize.tag o ON o.scope_id = t.owner_id AND o.kind = 'document' AND lower(o.name) = ${TAG_NAME}
ON CONFLICT DO NOTHING;
INSERT INTO organize.folder_tag (entity_id, tag_id)
SELECT ft.folder_id, o.id
  FROM public.folder_tags ft
  JOIN public.tags t ON t.id = ft.tag_id
  JOIN public.folders f ON f.id = ft.folder_id
  JOIN public.collections c ON c.id = f.collection_id AND c.owner_id = t.owner_id
  JOIN organize.tag o ON o.scope_id = t.owner_id AND o.kind = 'document' AND lower(o.name) = ${TAG_NAME}
ON CONFLICT DO NOTHING;`;

/** The tables the new kinds need, as the package emits them (a changed emitter fails `migrations.test.ts`, never silently). */
export const TAG_LIST_DDL = `CREATE TABLE organize.collection_tag (
  entity_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL,
  kind      text NOT NULL DEFAULT 'document' CHECK (kind = 'document'),
  PRIMARY KEY (entity_id, tag_id),
  FOREIGN KEY (tag_id, kind) REFERENCES organize.tag (id, kind) ON DELETE CASCADE
);
CREATE INDEX collection_tag_tag ON organize.collection_tag (tag_id);
CREATE TABLE organize.collection_status (
  entity_id  uuid PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
  state      text NOT NULL CHECK (state ~ '^[a-z][a-z0-9_]{0,39}$'),
  changed_at timestamptz NOT NULL,
  changed_by uuid REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX collection_status_state ON organize.collection_status (state);

CREATE TABLE organize.folder_tag (
  entity_id uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL,
  kind      text NOT NULL DEFAULT 'document' CHECK (kind = 'document'),
  PRIMARY KEY (entity_id, tag_id),
  FOREIGN KEY (tag_id, kind) REFERENCES organize.tag (id, kind) ON DELETE CASCADE
);
CREATE INDEX folder_tag_tag ON organize.folder_tag (tag_id);
CREATE TABLE organize.folder_status (
  entity_id  uuid PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
  state      text NOT NULL CHECK (state ~ '^[a-z][a-z0-9_]{0,39}$'),
  changed_at timestamptz NOT NULL,
  changed_by uuid REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX folder_status_state ON organize.folder_status (state);`;

export const TAG_LIST_SQL = `${TAG_LIST_DDL}
UPDATE public.krizaka_module_versions SET checksum = '${WORKSPACE_CHECKSUM}' WHERE module = 'organize_workspace' AND version = 1;${TAG_LIST_COPY_SQL}`;
