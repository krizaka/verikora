import { describeStore, type LocalKeys, parseVaultKey, STORAGE_CODE, StorageError } from "@krizaka/storage";
import { type Actor, type ProviderService, type ProviderStore, type PublicProvider } from "@krizaka/storage/provider-admin";
import { STORAGE_KIND } from "@yomizaka/core";

import { logError } from "../log";
import { documentStoreOver } from "./adapter";
import { dualObjectStore } from "./dual-read";
import type { DocumentStore } from "./port";
import { asDescriptor } from "./where";

/** The scope of the deployment's providers (ADR-005): the admin's, not a user's. */
export const ORG_SCOPE = "org";
/** The kinds of data this product keeps in a provider. */
export const DATA_KIND = { documents: "documents", avatars: "avatars" } as const;

/** A signed link lives at most this long, whatever the admin asks: a document is personal data. */
// @fixed: a link to personal data that outlives a reading session is a leak
export const MAX_SIGNED_URL_SECONDS = 900;

/** The only environment variable that stays for storage: the key-encryption key. The other `MEDIA_*` values are read once, to import the provider the deployment already used. */
export interface VaultEnv {
  MEDIA_VAULT_KEY?: string;
  APP_SETTINGS_ENCRYPTION_KEY?: string;
}

/** The old coordinates and keys of the documents store (read by the edge, passed in): imported once as a provider, never read again. */
export interface ProviderEnv {
  MEDIA_DOCUMENTS_PROVIDER: "none" | "bunny" | "s3" | "database" | "device";
  MEDIA_DOCUMENTS_PREFIX: string;
  MEDIA_DOCUMENTS_ENCRYPTION_KEY?: string;
  MEDIA_STORAGE_ENDPOINT: string;
  MEDIA_STORAGE_ZONE?: string;
  MEDIA_STORAGE_API_KEY?: string;
  MEDIA_DOCUMENTS_PULL_HOSTNAME?: string;
  MEDIA_DOCUMENTS_TOKEN_KEY?: string;
  MEDIA_S3_ENDPOINT?: string;
  MEDIA_S3_REGION?: string;
  MEDIA_S3_BUCKET?: string;
  MEDIA_S3_ACCESS_KEY_ID?: string;
  MEDIA_S3_SECRET_ACCESS_KEY?: string;
}

const MEDIA_KEY_ID = "media-1";
const SETTINGS_KEY_ID = "settings-1";

/** Drops the empty values: a field not given is not a field set to nothing. */
const given = (values: Record<string, string | undefined>): Record<string, string> => Object.fromEntries(Object.entries(values).filter(([, v]) => !!v)) as Record<string, string>;

/**
 * The key that seals the credentials (`MEDIA_VAULT_KEY`). Until it is deployed, the settings key that sealed a workspace's own S3 keeps the
 * product working; both stay in the ring, so a value sealed under either opens and `rotateVaultKey` moves it to the current one. Null with neither.
 */
export function vaultFrom(e: VaultEnv): { keyId: string; key: Uint8Array; ring: LocalKeys } | null {
  const media = e.MEDIA_VAULT_KEY ? parseVaultKey(e.MEDIA_VAULT_KEY) : null;
  const settings = e.APP_SETTINGS_ENCRYPTION_KEY ? parseVaultKey(e.APP_SETTINGS_ENCRYPTION_KEY) : null;
  const current = media ?? settings;
  if (!current) return null;
  const keys: Record<string, Uint8Array> = {};
  if (media) keys[MEDIA_KEY_ID] = media;
  if (settings) keys[SETTINGS_KEY_ID] = settings;
  return { keyId: media ? MEDIA_KEY_ID : SETTINGS_KEY_ID, key: current, ring: { keys, ...(settings ? { legacy: settings } : {}) } };
}

/** What the bootstrap imports: the provider the environment describes, or null when keeping is off or the values are not all there. */
export function envProvider(e: ProviderEnv) {
  const dataKinds = [DATA_KIND.documents, DATA_KIND.avatars];
  const encryptionKey = e.MEDIA_DOCUMENTS_ENCRYPTION_KEY;
  if (e.MEDIA_DOCUMENTS_PROVIDER === "bunny") {
    if (!e.MEDIA_STORAGE_ZONE || !e.MEDIA_STORAGE_API_KEY) return null;
    const coordinates = given({ endpoint: e.MEDIA_STORAGE_ENDPOINT, zone: e.MEDIA_STORAGE_ZONE, prefix: e.MEDIA_DOCUMENTS_PREFIX, pullHostname: e.MEDIA_DOCUMENTS_PULL_HOSTNAME });
    const credentials = given({ accessKey: e.MEDIA_STORAGE_API_KEY, tokenKey: e.MEDIA_DOCUMENTS_TOKEN_KEY, encryptionKey });
    return { kind: "bunny", coordinates, credentials, label: `Bunny zone ${e.MEDIA_STORAGE_ZONE} (imported from the environment)`, dataKinds };
  }
  if (e.MEDIA_DOCUMENTS_PROVIDER === "s3") {
    if (!e.MEDIA_S3_ENDPOINT || !e.MEDIA_S3_REGION || !e.MEDIA_S3_BUCKET || !e.MEDIA_S3_ACCESS_KEY_ID || !e.MEDIA_S3_SECRET_ACCESS_KEY) return null;
    const coordinates = given({ endpoint: e.MEDIA_S3_ENDPOINT, region: e.MEDIA_S3_REGION, bucket: e.MEDIA_S3_BUCKET, prefix: e.MEDIA_DOCUMENTS_PREFIX });
    const credentials = given({ accessKeyId: e.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey: e.MEDIA_S3_SECRET_ACCESS_KEY, encryptionKey });
    return { kind: "s3", coordinates, credentials, label: `S3 bucket ${e.MEDIA_S3_BUCKET} (imported from the environment)`, dataKinds };
  }
  return null;
}

/** The environment only bootstraps: imports its provider once, when the database holds none. Returns the new provider, or null. */
export const bootstrapStorage = (service: ProviderService, e: ProviderEnv): Promise<PublicProvider | null> => service.bootstrap(envProvider(e));

/**
 * The store of the default provider for a kind of data, as the product's `DocumentStore` (its descriptor says where it is, from the
 * provider's own coordinates), or null when none is set or the provider is not usable: nothing is kept (ADR-0012, 503 STORAGE_NOT_CONFIGURED).
 */
export async function documentsStoreOver(service: ProviderService, providers: Pick<ProviderStore, "defaultFor">, dataKind: string = DATA_KIND.documents): Promise<{ id: string; store: DocumentStore } | null> {
  const id = await providers.defaultFor(ORG_SCOPE, dataKind);
  if (!id) return null;
  const provider = (await service.list(ORG_SCOPE)).find((p) => p.id === id);
  if (!provider) return null;
  let objects;
  try {
    objects = await dualObjectStore(service, id, ORG_SCOPE);
  } catch (error) {
    if (error instanceof StorageError && (error.code === STORAGE_CODE.notVerified || error.code === STORAGE_CODE.badConfig)) {
      logError(`storage: the default provider of ${dataKind} cannot be opened (${error.code})`);
      return null;
    }
    throw error;
  }
  const isBunny = provider.kind === STORAGE_KIND.bunny;
  const descriptor = describeStore({ provider: isBunny ? "http" : "s3", endpoint: provider.coordinates.endpoint ?? "", region: provider.coordinates.region ?? "" }, { encrypted: provider.credentials.encryptionKey === "set", httpKind: "bunny" });
  return { id, store: documentStoreOver(objects, asDescriptor(descriptor), MAX_SIGNED_URL_SECONDS) };
}

/** The admin as the trail names them. */
export const actorOf = (account: { id: string; email: string }): Actor => ({ id: account.id, label: account.email });
