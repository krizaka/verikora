import type { Actor } from "@krizaka/storage/provider-admin";
import { STORAGE_MODE, type StorageMode } from "@yomizaka/core";
import type { QueryResultRow } from "pg";

import { refuse } from "../http";
import { noneStore } from "./none";
import { cloudBucketStore, disconnectedStore, ownBucketStore, type OwnProviders, registerOwnS3, replaceOwnS3Key, storedSecret } from "./own-providers";
import type { DocumentStore } from "./port";

/**
 * Where an owner's kept documents live (ADR-0007): `none` (nothing can be kept), `krizaka` (the store this deployment
 * configures), or `s3` (the owner's own S3-compatible cloud: endpoint, region, bucket and credentials, the secret sealed with the
 * registry's vault, as a provider at user scope: ADR-005). Today the owner is the account; it becomes the workspace when workspaces land (#126).
 */
type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;


export interface OwnS3 {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
}

export interface StorageSettings {
  mode: StorageMode;
  keepDefault: boolean;
  s3: (OwnS3 & { hasSecret: boolean }) | null;
  /** The cloud a person connected (`connected` false once they disconnected it: the documents it holds are then unreachable until they connect it again). */
  cloud: { connector: string; connected: boolean } | null;
  testedAt: string | null;
}

interface Row extends QueryResultRow {
  mode: StorageMode;
  keep_default: boolean;
  s3_endpoint: string | null;
  s3_region: string | null;
  s3_bucket: string | null;
  s3_access_key_id: string | null;
  s3_secret_sealed: string | null;
  provider_id: string | null;
  tested_at: Date | null;
  cloud_connector: string | null;
}

const COLUMNS = "cloud_connector, mode, keep_default, s3_endpoint, s3_region, s3_bucket, s3_access_key_id, s3_secret_sealed, provider_id, tested_at";

const publicView = (r: Row | undefined): StorageSettings =>
  !r
    ? { mode: "krizaka", keepDefault: false, s3: null, cloud: null, testedAt: null }
    : { mode: r.mode, keepDefault: r.keep_default, s3: r.s3_endpoint ? { endpoint: r.s3_endpoint, region: r.s3_region ?? "", bucket: r.s3_bucket ?? "", accessKeyId: r.s3_access_key_id ?? "", hasSecret: !!(r.provider_id ?? r.s3_secret_sealed) } : null, cloud: r.cloud_connector ? { connector: r.cloud_connector, connected: r.mode === STORAGE_MODE.cloud } : null, testedAt: r.tested_at?.toISOString() ?? null };

/** What the page may see: never the secret. */
export async function loadSettings(q: Query, owner: string): Promise<StorageSettings> {
  const [row] = await q<Row>(`SELECT ${COLUMNS} FROM storage_settings WHERE owner_id = $1`, [owner]);
  return publicView(row);
}

export interface SettingsInput {
  mode: StorageMode;
  keepDefault: boolean;
  s3?: OwnS3 & { secretAccessKey?: string };
}

/**
 * Saves the settings. An own S3 lives in the registry (ADR-005): a new bucket is registered (created, tested, made the default), new keys for
 * the same bucket go through `changeKey` (tested first), and none given keeps the ones already stored. `s3` mode needs all its fields.
 */
export async function saveSettings(q: Query, owner: string, input: SettingsInput, own: OwnProviders | null, actor: Actor, now: Date): Promise<StorageSettings> {
  if (input.keepDefault && input.mode === STORAGE_MODE.none) throw refuse(400, "BAD_REQUEST", "Nothing can be kept by default when keeping is off");
  if (input.mode !== STORAGE_MODE.s3) {
    await q(
      `INSERT INTO storage_settings (owner_id, mode, keep_default, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id) DO UPDATE SET mode = excluded.mode, keep_default = excluded.keep_default, updated_at = excluded.updated_at`,
      [owner, input.mode, input.keepDefault, now],
    );
    return loadSettings(q, owner);
  }
  const s3 = input.s3;
  if (!s3?.endpoint || !s3.region || !s3.bucket || !s3.accessKeyId) throw refuse(400, "BAD_REQUEST", "Endpoint, region, bucket and access key are required");
  if (!own) throw refuse(503, "SETTINGS_KEY_MISSING", "Storing credentials is not available on this deployment");
  const [existing] = await q<Row>(`SELECT ${COLUMNS} FROM storage_settings WHERE owner_id = $1`, [owner]);
  const providerId = await registerOrKeep(own, actor, owner, s3, existing);
  await q(
    `INSERT INTO storage_settings (owner_id, mode, keep_default, s3_endpoint, s3_region, s3_bucket, s3_access_key_id, provider_id, tested_at, updated_at)
     VALUES ($1, 's3', $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (owner_id) DO UPDATE SET mode = 's3', keep_default = excluded.keep_default, s3_endpoint = excluded.s3_endpoint, s3_region = excluded.s3_region,
       s3_bucket = excluded.s3_bucket, s3_access_key_id = excluded.s3_access_key_id, s3_secret_sealed = NULL, provider_id = excluded.provider_id, tested_at = excluded.tested_at, updated_at = excluded.updated_at`,
    [owner, input.keepDefault, s3.endpoint, s3.region, s3.bucket, s3.accessKeyId, providerId, now],
  );
  return loadSettings(q, owner);
}

/** The provider that serves this S3 after the save: the same one (new keys tested first, or nothing changed) or a new one for another bucket. */
async function registerOrKeep(own: OwnProviders, actor: Actor, owner: string, s3: OwnS3 & { secretAccessKey?: string }, existing: Row | undefined): Promise<string> {
  const current = existing?.provider_id ?? null;
  const sameBucket = !!current && existing?.s3_endpoint === s3.endpoint && existing.s3_region === s3.region && existing.s3_bucket === s3.bucket;
  if (sameBucket && !s3.secretAccessKey && existing?.s3_access_key_id === s3.accessKeyId) return current!;
  const secretAccessKey = s3.secretAccessKey || (await storedSecret(own, current));
  if (!secretAccessKey) throw refuse(400, "BAD_REQUEST", "The secret access key is required");
  const credentials = { accessKeyId: s3.accessKeyId, secretAccessKey };
  if (sameBucket) {
    await replaceOwnS3Key(own, actor, current!, credentials);
    return current!;
  }
  const id = await registerOwnS3(own, actor, owner, { endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, ...credentials });
  if (current) await own.service.disable(actor, current).catch(() => undefined);
  return id;
}

/**
 * The owner's own cloud as a store (opened by the registry, the credentials nowhere else), or null when the owner has none. An S3 is theirs
 * while the mode is `s3`; a connected cloud while it is `cloud`. After a disconnect the documents it holds still name it: the store answers
 * `STORAGE_DISCONNECTED` to a read instead of pretending nothing is there, and a delete is a no-op (the file is in their cloud, not ours).
 */
export async function ownS3Store(q: Query, owner: string, own: OwnProviders | null): Promise<DocumentStore | null> {
  const [row] = await q<Row>(`SELECT ${COLUMNS} FROM storage_settings WHERE owner_id = $1`, [owner]);
  if (!row) return null;
  if (row.cloud_connector && row.mode !== STORAGE_MODE.cloud) return disconnectedStore(row.cloud_connector);
  if (row.mode === STORAGE_MODE.cloud) return row.provider_id && own ? cloudBucketStore(own, row.provider_id, row.cloud_connector ?? "") : null;
  if (row.mode !== STORAGE_MODE.s3 || !row.s3_endpoint || !row.provider_id || !own) return null;
  return ownBucketStore(own, row.provider_id, { endpoint: row.s3_endpoint, region: row.s3_region ?? "" });
}

/** The store an owner's documents use: nothing (kept off), the deployment's own (Krizaka), or the owner's S3. */
export async function storeForOwner(q: Query, owner: string, own: OwnProviders | null, krizaka: DocumentStore): Promise<{ store: DocumentStore; settings: StorageSettings }> {
  const settings = await loadSettings(q, owner);
  if (settings.mode === STORAGE_MODE.none) return { store: noneStore(), settings };
  if (settings.mode === STORAGE_MODE.s3 || settings.mode === STORAGE_MODE.cloud) {
    const theirs = await ownS3Store(q, owner, own);
    if (!theirs) throw refuse(503, "STORAGE_UNAVAILABLE", "The workspace's storage is not available");
    return { store: theirs, settings };
  }
  return { store: krizaka, settings };
}

/** A connected cloud becomes where the person's kept documents go. */
export async function saveCloud(q: Query, owner: string, connector: string, providerId: string, now: Date): Promise<StorageSettings> {
  await q(
    `INSERT INTO storage_settings (owner_id, mode, keep_default, cloud_connector, provider_id, tested_at, updated_at) VALUES ($1, 'cloud', false, $2, $3, $4, $4)
     ON CONFLICT (owner_id) DO UPDATE SET mode = 'cloud', cloud_connector = excluded.cloud_connector, provider_id = excluded.provider_id, tested_at = excluded.tested_at, updated_at = excluded.updated_at`,
    [owner, connector, providerId, now],
  );
  return loadSettings(q, owner);
}

/** The person disconnected: new documents go back to Krizaka's store; the connector and provider stay named, because the documents in their cloud still do. */
export async function saveDisconnected(q: Query, owner: string, now: Date): Promise<StorageSettings> {
  await q("UPDATE storage_settings SET mode = 'krizaka', keep_default = false, updated_at = $2 WHERE owner_id = $1 AND mode = 'cloud'", [owner, now]);
  return loadSettings(q, owner);
}

/** The provider the person's cloud (or S3) is registered as, or null. */
export async function ownProviderId(q: Query, owner: string): Promise<{ providerId: string | null; connector: string | null }> {
  const [row] = await q<Row>(`SELECT ${COLUMNS} FROM storage_settings WHERE owner_id = $1`, [owner]);
  return { providerId: row?.provider_id ?? null, connector: row?.cloud_connector ?? null };
}
