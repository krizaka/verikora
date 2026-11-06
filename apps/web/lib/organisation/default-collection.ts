/**
 * The default collection (krizaka/verikora#205), kept by the database itself so no path can break it: every account has exactly one,
 * every file has a collection, and the default one is never deleted. These are the migration's SQL pieces, kept in a module of their
 * own so the backfill can be run by its test on an account as it was before the feature.
 */

/** Gives an account a library and a default collection, named in its language; the one function the account trigger and the backfill share. */
export const DEFAULT_COLLECTION_FUNCTION = `
CREATE FUNCTION create_default_collection(p_owner uuid, p_locale text) RETURNS uuid AS $$
DECLARE
  lib uuid;
  col uuid;
  base text := CASE p_locale WHEN 'fr' THEN 'Mes documents' ELSE 'My documents' END;
  candidate text;
  n int := 1;
BEGIN
  SELECT id INTO lib FROM libraries WHERE owner_id = p_owner ORDER BY created_at, id LIMIT 1;
  IF lib IS NULL THEN
    INSERT INTO libraries (owner_id, name) VALUES (p_owner, CASE p_locale WHEN 'fr' THEN 'Ma bibliothèque' ELSE 'My library' END) RETURNING id INTO lib;
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM collections WHERE library_id = lib AND name = candidate) LOOP
    n := n + 1;
    candidate := base || ' ' || n;
  END LOOP;
  INSERT INTO collections (library_id, owner_id, name, is_default) VALUES (lib, p_owner, candidate, true) RETURNING id INTO col;
  RETURN col;
END
$$ LANGUAGE plpgsql;
`;

/** For every account without a default collection: one; then every file with no place goes into it. Safe to run again. */
export const BACKFILL_DEFAULT_COLLECTIONS = `
SELECT create_default_collection(a.id, a.locale) FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM collections c WHERE c.owner_id = a.id AND c.is_default);
UPDATE documents d SET collection_id = c.id, folder_id = NULL FROM collections c WHERE d.collection_id IS NULL AND c.owner_id = d.owner_id AND c.is_default;
`;

export const DEFAULT_COLLECTION_MIGRATION = `
-- krizaka/verikora#205: every account has one default collection, never deleted; a file always has a collection.
-- A collection knows its owner (a composite key to its library keeps them the same), so « one per owner » is a constraint.
ALTER TABLE libraries ADD CONSTRAINT libraries_id_owner UNIQUE (id, owner_id);
ALTER TABLE collections ADD COLUMN owner_id uuid;
UPDATE collections c SET owner_id = l.owner_id FROM libraries l WHERE l.id = c.library_id;
ALTER TABLE collections ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE collections ADD CONSTRAINT collections_library_owner FOREIGN KEY (library_id, owner_id) REFERENCES libraries (id, owner_id) ON DELETE CASCADE;
ALTER TABLE collections ADD COLUMN is_default boolean NOT NULL DEFAULT false;
-- at most one default per owner; checked at the end of the statement, so a swap in one UPDATE is allowed
ALTER TABLE collections ADD CONSTRAINT collections_one_default EXCLUDE USING btree (owner_id WITH =) WHERE (is_default) DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION collections_fill_owner() RETURNS trigger AS $$
BEGIN
  SELECT owner_id INTO NEW.owner_id FROM libraries WHERE id = NEW.library_id;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER collections_fill_owner BEFORE INSERT ON collections FOR EACH ROW WHEN (NEW.owner_id IS NULL) EXECUTE FUNCTION collections_fill_owner();

${DEFAULT_COLLECTION_FUNCTION}

CREATE FUNCTION accounts_default_collection() RETURNS trigger AS $$
BEGIN
  PERFORM create_default_collection(NEW.id, NEW.locale);
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER accounts_default_collection AFTER INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_default_collection();

-- the default one cannot be deleted while its account exists (an account's own deletion still removes everything)
CREATE FUNCTION collections_guard_default() RETURNS trigger AS $$
BEGIN
  IF OLD.is_default AND EXISTS (SELECT 1 FROM accounts WHERE id = OLD.owner_id) THEN
    RAISE EXCEPTION 'DEFAULT_COLLECTION: the default collection cannot be deleted';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER collections_guard_default BEFORE DELETE ON collections FOR EACH ROW EXECUTE FUNCTION collections_guard_default();

-- and an account is never left without exactly one, whatever the statement (checked when the transaction ends)
CREATE FUNCTION collections_exactly_one_default() RETURNS trigger AS $$
DECLARE o uuid := COALESCE(NEW.owner_id, OLD.owner_id);
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE id = o) AND (SELECT count(*) FROM collections WHERE owner_id = o AND is_default) <> 1 THEN
    RAISE EXCEPTION 'DEFAULT_COLLECTION: an account has exactly one default collection';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER collections_exactly_one_default AFTER INSERT OR UPDATE OR DELETE ON collections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION collections_exactly_one_default();

-- a file given no place goes into the owner's default collection, on insert and when its place is removed
CREATE FUNCTION documents_default_collection() RETURNS trigger AS $$
BEGIN
  IF NEW.collection_id IS NULL THEN
    SELECT id INTO NEW.collection_id FROM collections WHERE owner_id = NEW.owner_id AND is_default;
    NEW.folder_id := NULL;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER documents_default_collection BEFORE INSERT OR UPDATE OF collection_id ON documents FOR EACH ROW WHEN (NEW.collection_id IS NULL) EXECUTE FUNCTION documents_default_collection();

${BACKFILL_DEFAULT_COLLECTIONS}
`;
