import { createProviderService, memoryProviderStore } from "@krizaka/storage/provider-admin";
import { describe, expect, it } from "vitest";

import { bootstrapStorage, documentsStoreOver, envProvider, type ProviderEnv, vaultFrom } from "./providers";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

const bunnyEnv: ProviderEnv = {
  MEDIA_DOCUMENTS_PROVIDER: "bunny",
  MEDIA_DOCUMENTS_PREFIX: "verikora",
  MEDIA_STORAGE_ENDPOINT: "storage.bunnycdn.com",
  MEDIA_STORAGE_ZONE: "yomizaka-docs-dev",
  MEDIA_STORAGE_API_KEY: "zone-password",
  MEDIA_DOCUMENTS_PULL_HOSTNAME: "yomizaka-docs-dev.b-cdn.net",
  MEDIA_DOCUMENTS_TOKEN_KEY: "token-key",
  MEDIA_DOCUMENTS_ENCRYPTION_KEY: KEY_B,
};

describe("the vault key", () => {
  it("is MEDIA_VAULT_KEY, and the old settings key stays in the ring so sealed values still open", () => {
    const vault = vaultFrom({ MEDIA_VAULT_KEY: KEY_A, APP_SETTINGS_ENCRYPTION_KEY: KEY_B });
    expect(vault?.keyId).toBe("media-1");
    expect(Object.keys(vault!.ring.keys).sort()).toEqual(["media-1", "settings-1"]);
  });
  it("falls back to the settings key while the new one is not deployed, and is null with neither", () => {
    expect(vaultFrom({ APP_SETTINGS_ENCRYPTION_KEY: KEY_B })?.keyId).toBe("settings-1");
    expect(vaultFrom({})).toBeNull();
  });
});

describe("the environment's old coordinates", () => {
  it("become the dev Bunny zone provider, the encryption key a sealed credential", () => {
    const imported = envProvider(bunnyEnv)!;
    expect(imported.kind).toBe("bunny");
    expect(imported.coordinates).toMatchObject({
      zone: "yomizaka-docs-dev",
      endpoint: "storage.bunnycdn.com",
      prefix: "verikora",
      pullHostname: "yomizaka-docs-dev.b-cdn.net",
    });
    expect(imported.credentials).toEqual({ accessKey: "zone-password", tokenKey: "token-key", encryptionKey: KEY_B });
    expect(imported.dataKinds).toEqual(["documents", "avatars"]);
  });
  it("become an s3 provider", () => {
    const imported = envProvider({
      MEDIA_DOCUMENTS_PROVIDER: "s3",
      MEDIA_DOCUMENTS_PREFIX: "verikora",
      MEDIA_STORAGE_ENDPOINT: "x",
      MEDIA_S3_ENDPOINT: "https://tor1.digitaloceanspaces.com",
      MEDIA_S3_REGION: "tor1",
      MEDIA_S3_BUCKET: "docs",
      MEDIA_S3_ACCESS_KEY_ID: "id",
      MEDIA_S3_SECRET_ACCESS_KEY: "secret",
    })!;
    expect(imported.kind).toBe("s3");
    expect(imported.coordinates).toMatchObject({
      endpoint: "https://tor1.digitaloceanspaces.com",
      region: "tor1",
      bucket: "docs",
    });
    expect(imported.credentials).toEqual({ accessKeyId: "id", secretAccessKey: "secret" });
  });
  it("import nothing when keeping is off or the values are missing", () => {
    expect(envProvider({ ...bunnyEnv, MEDIA_DOCUMENTS_PROVIDER: "none" })).toBeNull();
    expect(envProvider({ ...bunnyEnv, MEDIA_STORAGE_API_KEY: undefined })).toBeNull();
  });
});

describe("the documents store, chosen from the admin's providers", () => {
  const harness = () => {
    const store = memoryProviderStore();
    const notes: string[] = [];
    let n = 0;
    const service = createProviderService({
      store,
      vault: { keyId: "media-1", key: Buffer.alloc(32, 1), ring: { keys: { "media-1": Buffer.alloc(32, 1) } } },
      clock: { now: () => new Date("2026-10-28T12:00:00Z") },
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      audit: async (note) => void notes.push(note.action),
      open: {
        runtime: "dev",
        environment: "dev",
        fetch: async () => new Response(null, { status: 200 }),
        clock: { now: () => new Date("2026-10-28T12:00:00Z") },
      },
      probeId: () => "probe",
      references: async () => 0,
    });
    return { store, service, notes };
  };

  it("has none until the environment bootstraps one: nothing is kept (503 STORAGE_NOT_CONFIGURED)", async () => {
    const { service, store } = harness();
    expect(await documentsStoreOver(service, store)).toBeNull();
  });

  it("bootstraps once from the environment, audited, then the database chooses (a second start imports nothing)", async () => {
    const { service, store, notes } = harness();
    const first = await bootstrapStorage(service, bunnyEnv);
    expect(first?.source).toBe("env");
    expect(first?.credentials).toEqual({ accessKey: "set", tokenKey: "set", encryptionKey: "set" });
    expect(JSON.stringify(first)).not.toContain("zone-password");
    expect(notes).toEqual(["storage.provider_imported"]);
    expect(await bootstrapStorage(service, { ...bunnyEnv, MEDIA_STORAGE_ZONE: "other" })).toBeNull();
    const opened = await documentsStoreOver(service, store);
    expect(opened?.id).toBe(first?.id);
    expect(opened?.store.describe()).toMatchObject({ kind: "bunny", devOnly: true, encrypted: true });
  });

  it("never hands out the store of a disabled provider", async () => {
    const { service, store } = harness();
    const first = await bootstrapStorage(service, bunnyEnv);
    await store.update(first!.id, { status: "disabled" });
    expect(await documentsStoreOver(service, store)).toBeNull();
  });
});
