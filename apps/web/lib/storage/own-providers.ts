import { createHash } from "node:crypto";

import { describeStore, type LocalKeys, openEnvelope, sealEnvelope, StorageError } from "@krizaka/storage";
import type { Actor, ProviderService, ProviderStore } from "@krizaka/storage/provider-admin";
import type { QueryResultRow } from "pg";

import { refuse } from "../http";
import { documentStoreOver } from "./adapter";
import type { DocumentStore, StoreDescriptor } from "./port";
import { DATA_KIND, MAX_SIGNED_URL_SECONDS } from "./providers";
import { asDescriptor } from "./where";

/**
 * A person's own S3 is a provider at user scope of the registry (ADR-005 §4): same kind as the admin's S3, sealed under the vault, tested
 * by the same `test`, audited by the same trail. This module is the product's side of it: which provider is whose, and the one-time move
 * of the settings rows that kept the secret themselves (ADR-0007).
 */
export interface OwnProviders {
  service: ProviderService;
  store: ProviderStore;
  vault: { keyId: string; key: Uint8Array; ring: LocalKeys };
}

type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

export const userScope = (owner: string) => `user:${owner}`;
/** The key prefix of Yomizaka's objects in a person's bucket (kept as it was, so every existing key still resolves). */
export const OWN_PREFIX = "yomizaka";
const LABEL = "My S3";

export interface OwnS3Coordinates {
  endpoint: string;
  region: string;
  bucket: string;
}

/** A person's own bucket as a store: the registry opens it (credentials opened there and nowhere else); the descriptor says it is theirs, and where. */
export async function ownBucketStore(own: Pick<OwnProviders, "service">, providerId: string, where: { endpoint: string; region: string }): Promise<DocumentStore> {
  const objects = await own.service.open(providerId);
  return documentStoreOver(objects, asDescriptor(describeStore({ provider: "s3", endpoint: where.endpoint, region: where.region }, { encrypted: false, owner: "workspace" })), MAX_SIGNED_URL_SECONDS);
}

/** The secret access key a person saved, opened for a test or a coordinate change (never sent back to a browser). Null when none is stored. */
export async function storedSecret(own: Pick<OwnProviders, "store" | "vault">, providerId: string | null): Promise<string | null> {
  const record = providerId ? await own.store.get(providerId) : null;
  if (!record) return null;
  const credentials = JSON.parse(openEnvelope(record.sealedCredentials, own.vault.ring)) as { secretAccessKey?: string };
  return credentials.secretAccessKey ?? null;
}

/** The registry tests a new provider; a red test leaves nothing in use, a green one makes it the default of the person's documents. */
async function verifiedDefault(own: Pick<OwnProviders, "service">, actor: Actor, id: string, scope: ReturnType<typeof userScope>): Promise<string> {
  const tested = await own.service.test(actor, id);
  const outcome: string = tested.status;
  if (outcome !== "verified") {
    await own.service.disable(actor, id).catch(() => undefined);
    throw refuse(422, "CONNECTION_FAILED", "The connection test failed", { steps: tested.lastTest?.steps ?? [] });
  }
  await own.service.setDefault(actor, id, scope, DATA_KIND.documents);
  return id;
}

/** Registers a person's S3 in the registry: created, tested by the registry, made the default of their documents. A red test leaves nothing in use. */
export async function registerOwnS3(own: Pick<OwnProviders, "service">, actor: Actor, owner: string, s3: OwnS3Coordinates & { accessKeyId: string; secretAccessKey: string }): Promise<string> {
  const scope = userScope(owner);
  const created = await own.service.create(actor, {
    scope,
    kind: "s3",
    preset: "generic",
    label: LABEL,
    coordinates: { endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, prefix: OWN_PREFIX },
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
  return verifiedDefault(own, actor, created.id, scope);
}

/** New credentials for the same bucket: the registry tests them first and refuses a red one. */
export async function replaceOwnS3Key(own: Pick<OwnProviders, "service">, actor: Actor, providerId: string, credentials: { accessKeyId: string; secretAccessKey: string }): Promise<void> {
  try {
    await own.service.changeKey(actor, providerId, credentials);
  } catch (error) {
    if (error instanceof StorageError) throw refuse(422, "CONNECTION_FAILED", "The connection test failed");
    throw error;
  }
}

interface LegacyRow extends QueryResultRow {
  owner_id: string;
  s3_endpoint: string;
  s3_region: string | null;
  s3_bucket: string | null;
  s3_access_key_id: string | null;
  s3_secret_sealed: string;
  tested_at: Date | null;
}

export interface OwnS3Migration {
  moved: number;
  /** Rows left for a later start: incomplete, or sealed under a key this deployment no longer holds. */
  left: number;
}

/**
 * The data migration of ADR-005 slice 5: every settings row that still holds its own sealed secret becomes a provider in the registry's user
 * scope (credentials re-sealed under the vault, coordinates as they were, `verified` with the time it was last tested, the default of that
 * person's documents), the row names it (`provider_id`) and forgets the secret, and the documents kept on it name it too.
 * Idempotent: a moved row has a `provider_id` and is not read again; one that cannot be moved stays as it is and is counted in `left`.
 * Nothing is deleted from a bucket and nothing is read from it.
 */
export async function migrateOwnS3(q: Query, own: Pick<OwnProviders, "store" | "vault">, now: Date): Promise<OwnS3Migration> {
  const rows = await q<LegacyRow>(
    `SELECT owner_id, s3_endpoint, s3_region, s3_bucket, s3_access_key_id, s3_secret_sealed, tested_at FROM storage_settings
     WHERE provider_id IS NULL AND s3_secret_sealed IS NOT NULL AND s3_endpoint IS NOT NULL ORDER BY owner_id`,
  );
  const result: OwnS3Migration = { moved: 0, left: 0 };
  for (const row of rows) {
    const secret = openLegacySecret(row, own.vault.ring);
    if (!secret) {
      result.left += 1;
      continue;
    }
    await moveRow(q, own, row, secret, now);
    result.moved += 1;
  }
  return result;
}

/** The secret of a complete row, or null: an incomplete row, or one sealed under a key this deployment no longer holds, is left for a later start. */
function openLegacySecret(row: LegacyRow, ring: LocalKeys): string | null {
  if (!row.s3_region || !row.s3_bucket || !row.s3_access_key_id) return null;
  try {
    return openEnvelope(row.s3_secret_sealed, ring) || null;
  } catch {
    return null;
  }
}

/** A stable id for a person's migrated provider, so a start interrupted half-way finds what it already wrote instead of adding a second one. */
export function migratedProviderId(owner: string): string {
  const h = createHash("sha256").update(`yomizaka:own-s3:${owner}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function moveRow(q: Query, own: Pick<OwnProviders, "store" | "vault">, row: LegacyRow, secret: string, now: Date) {
  const scope = userScope(row.owner_id);
  const id = migratedProviderId(row.owner_id);
  if (!(await own.store.get(id))) {
    await own.store.insert({
      id,
      scope,
      kind: "s3",
      preset: "generic",
      label: LABEL,
      coordinates: { endpoint: row.s3_endpoint, region: row.s3_region!, bucket: row.s3_bucket!, prefix: OWN_PREFIX },
      sealedCredentials: sealEnvelope(JSON.stringify({ accessKeyId: row.s3_access_key_id, secretAccessKey: secret }), own.vault.key, own.vault.keyId),
      keyId: own.vault.keyId,
      status: "active",
      source: "admin",
      lastTest: null,
      createdBy: row.owner_id,
      createdAt: now,
      updatedAt: now,
    });
  }
  await own.store.setDefault(scope, DATA_KIND.documents, id);
  await q("UPDATE documents SET provider_id = $1 WHERE owner_id = $2 AND storage_owner = 'workspace' AND provider_id IS NULL", [id, row.owner_id]);
  await q("UPDATE storage_settings SET provider_id = $1, s3_secret_sealed = NULL WHERE owner_id = $2 AND provider_id IS NULL", [id, row.owner_id]);
}

/** The store of a connected cloud: the registry opens it (the grant is renewed there and resealed when the cloud rotates it); the descriptor says it is theirs, and which cloud. */
export async function cloudBucketStore(own: Pick<OwnProviders, "service">, providerId: string, connector: string): Promise<DocumentStore> {
  const objects = await own.service.open(providerId);
  return documentStoreOver(objects, cloudDescriptor(connector), MAX_SIGNED_URL_SECONDS);
}

const cloudDescriptor = (connector: string): StoreDescriptor => ({ kind: "cloud", endpoint: connector, region: null, residency: "unknown", encrypted: false, owner: "workspace", devOnly: false });

/**
 * What stands in for a cloud the person disconnected: a read says `STORAGE_DISCONNECTED` (409, the page offers to connect again), nothing
 * is written, and a delete is a no-op because the file is in their cloud: an erasure or a purge never waits for a cloud we cannot reach.
 */
export function disconnectedStore(connector: string): DocumentStore {
  const gone = () => refuse(409, "STORAGE_DISCONNECTED", "The cloud that holds this document is disconnected: connect it again to read it");
  return {
    async put() {
      throw gone();
    },
    async get() {
      throw gone();
    },
    async signedUrl() {
      throw gone();
    },
    async delete() {},
    describe: () => cloudDescriptor(connector),
  };
}

export interface CloudGrant {
  connector: string;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
}

/** Registers a connected cloud in the registry's user scope: created (the grant sealed), tested by the registry (a probe object written, read, deleted), made the default of their documents. A red test leaves nothing in use. */
export async function registerCloud(own: Pick<OwnProviders, "service">, actor: Actor, owner: string, grant: CloudGrant): Promise<string> {
  const scope = userScope(owner);
  const created = await own.service.create(actor, {
    scope,
    kind: grant.connector,
    label: `My ${grant.connector}`,
    coordinates: { clientId: grant.clientId, prefix: OWN_PREFIX },
    credentials: { refreshToken: grant.refreshToken, ...(grant.clientSecret ? { clientSecret: grant.clientSecret } : {}) },
  });
  return verifiedDefault(own, actor, created.id, scope);
}

/** The grant of a connected cloud, opened to be revoked at the provider (never sent to a browser). Null when none is stored. */
export async function storedRefreshToken(own: Pick<OwnProviders, "store" | "vault">, providerId: string | null): Promise<string | null> {
  const record = providerId ? await own.store.get(providerId) : null;
  if (!record) return null;
  return (JSON.parse(openEnvelope(record.sealedCredentials, own.vault.ring)) as { refreshToken?: string }).refreshToken ?? null;
}

/** After a disconnect: the sealed grant is replaced by nothing and the provider is disabled, so no store can be opened from it. The row stays, because the documents in their cloud still name it. */
export async function forgetGrant(own: Pick<OwnProviders, "store" | "vault">, providerId: string, now: Date): Promise<void> {
  await own.store.update(providerId, { status: "disabled", sealedCredentials: sealEnvelope("{}", own.vault.key, own.vault.keyId), keyId: own.vault.keyId, updatedAt: now });
}
