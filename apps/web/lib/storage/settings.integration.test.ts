import crypto from "node:crypto";

import { type FetchLike, seal } from "@krizaka/storage";
import { createProviderService, dbProviderStore } from "@krizaka/storage/provider-admin";
import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { memoryStore } from "./memory";
import { migratedProviderId, migrateOwnS3, type OwnProviders, userScope } from "./own-providers";
import { loadSettings, ownS3Store, saveSettings, storeForOwner } from "./settings";

/** A person's own S3 against a real PostgreSQL (skipped without YOMIZAKA_DB_IT=1 and DATABASE_URL): saved as a provider at user scope of the registry, and the move of the rows that kept their own key (ADR-005). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
const S3 = { endpoint: "https://s3.example.com", region: "ca-central-1", bucket: "docs", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "s3-secret-value" };
const ACTOR = { id: null, label: "test" };

/** A tiny S3 (path-style) that holds what is put in it; `down` makes every request fail. */
function fakeS3() {
  const objects = new Map<string, Uint8Array>();
  const state = { down: false };
  const fetchLike: FetchLike = async (url, init) => {
    const reply = (status: number, bytes?: Uint8Array) => ({ ok: status < 300, status, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(bytes ?? []).buffer, text: async () => "" });
    if (state.down) return reply(403);
    const key = new URL(url).pathname;
    if (init.method === "PUT") {
      objects.set(key, init.body!);
      return reply(200);
    }
    if (init.method === "GET") return objects.has(key) ? reply(200, objects.get(key)) : reply(404);
    if (init.method === "DELETE") return reply(objects.delete(key) ? 204 : 404);
    return reply(405);
  };
  return { objects, state, fetchLike };
}

describe.runIf(enabled)("a person's own S3 in the registry (ADR-005)", () => {
  const oldKey = crypto.randomBytes(32);
  const vaultKey = crypto.randomBytes(32);
  const vault = { keyId: "media-1", key: vaultKey, ring: { keys: { "media-1": vaultKey }, legacy: oldKey } };
  const bucket = fakeS3();
  const store = dbProviderStore(query);
  const service = createProviderService({
    store,
    vault,
    clock: { now: () => NOW },
    newId: () => crypto.randomUUID(),
    audit: async () => undefined,
    open: { runtime: "server", environment: "prod", fetch: bucket.fetchLike, clock: { now: () => NOW } },
    probeId: () => crypto.randomUUID(),
    references: async (id) => Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM documents WHERE provider_id = $1", [id]))[0]!.n),
    resolve: async () => ["93.184.216.34"],
  });
  const own: OwnProviders = { service, store, vault };
  beforeAll(async () => {
    await migrate();
  });
  const account = async () => (await query<{ id: string }>("INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id", [`s-${Math.random().toString(36).slice(2)}@yomizaka.test`]))[0]!.id;
  const sealedInRow = async (owner: string) => (await query<{ s: string | null }>("SELECT s3_secret_sealed AS s FROM storage_settings WHERE owner_id = $1", [owner]))[0]!.s;

  it("defaults to Krizaka's store, keeping off by default", async () => {
    expect(await loadSettings(query, await account())).toEqual({ mode: "krizaka", keepDefault: false, s3: null, cloud: null, testedAt: null });
  });

  it("saves an own S3 as a user-scope provider: sealed in the registry, never in the settings row, never returned", async () => {
    const owner = await account();
    const saved = await saveSettings(query, owner, { mode: "s3", keepDefault: true, s3: S3 }, own, ACTOR, NOW);
    expect(saved).toMatchObject({ mode: "s3", keepDefault: true, s3: { endpoint: "https://s3.example.com", region: "ca-central-1", bucket: "docs", accessKeyId: "AKIAEXAMPLE", hasSecret: true }, testedAt: NOW.toISOString() });
    expect(JSON.stringify(saved)).not.toContain("s3-secret-value");
    expect(await sealedInRow(owner)).toBeNull();
    const [provider] = await service.list(userScope(owner));
    expect(provider).toMatchObject({ kind: "s3", status: "active", credentials: { accessKeyId: "set", secretAccessKey: "set" }, coordinates: { bucket: "docs", prefix: "yomizaka" } });
    const [raw] = await query<{ sealed_credentials: string }>("SELECT sealed_credentials FROM storage.provider WHERE id = $1", [provider!.id]);
    expect(raw!.sealed_credentials).not.toContain("s3-secret-value");
    expect(await store.defaultFor(userScope(owner), "documents")).toBe(provider!.id);
  });

  it("keeps the stored key when a save gives none, and replaces it (tested first) when it gives one", async () => {
    const owner = await account();
    await saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW);
    const [first] = await service.list(userScope(owner));
    await saveSettings(query, owner, { mode: "s3", keepDefault: true, s3: { ...S3, secretAccessKey: undefined } }, own, ACTOR, NOW);
    expect((await service.list(userScope(owner))).map((p) => p.id)).toEqual([first!.id]);
    await saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: { ...S3, secretAccessKey: "new" } }, own, ACTOR, NOW);
    expect((await service.list(userScope(owner))).map((p) => p.id)).toEqual([first!.id]);
    bucket.state.down = true;
    await expect(saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: { ...S3, secretAccessKey: "bad" } }, own, ACTOR, NOW)).rejects.toMatchObject({ status: 422, body: { code: "CONNECTION_FAILED" } });
    bucket.state.down = false;
  });

  it("another bucket gets its own provider with the stored key; the old one stops being used", async () => {
    const owner = await account();
    await saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW);
    await saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: { ...S3, bucket: "other", secretAccessKey: undefined } }, own, ACTOR, NOW);
    const providers = await service.list(userScope(owner));
    expect(providers.map((p) => [p.coordinates.bucket, p.status]).sort()).toEqual([["docs", "disabled"], ["other", "active"]]);
  });

  it("a red test registers nothing in use; an incomplete S3 or a deployment without a vault is refused", async () => {
    const owner = await account();
    bucket.state.down = true;
    await expect(saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW)).rejects.toMatchObject({ status: 422 });
    bucket.state.down = false;
    expect(await store.defaultFor(userScope(owner), "documents")).toBeNull();
    await expect(saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: S3 }, null, ACTOR, NOW)).rejects.toMatchObject({ status: 503, body: { code: "SETTINGS_KEY_MISSING" } });
    await expect(saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: { ...S3, bucket: "" } }, own, ACTOR, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: { ...S3, secretAccessKey: undefined } }, own, ACTOR, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it("nothing can be kept by default when keeping is switched off", async () => {
    await expect(saveSettings(query, await account(), { mode: "none", keepDefault: true }, own, ACTOR, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it("the owner's S3 becomes a store that says it is the workspace's, with its host and region, and holds what is put in it", async () => {
    const owner = await account();
    expect(await ownS3Store(query, owner, own)).toBeNull();
    await saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW);
    const theirs = (await ownS3Store(query, owner, own))!;
    expect(theirs.describe()).toMatchObject({ kind: "s3", owner: "workspace", endpoint: "s3.example.com", region: "ca-central-1", residency: "canada", devOnly: false });
    await theirs.put("probe/a.txt", new TextEncoder().encode("hello"), { contentType: "text/plain" });
    expect([...bucket.objects.keys()].some((k) => k.includes("/docs/yomizaka/probe/a.txt"))).toBe(true);
    expect(await ownS3Store(query, owner, null)).toBeNull();
  });

  it("which store an owner's documents use: nothing, Krizaka's, or their own", async () => {
    const owner = await account();
    const krizaka = memoryStore({ kind: "s3" });
    expect((await storeForOwner(query, owner, own, krizaka)).store).toBe(krizaka);
    await saveSettings(query, owner, { mode: "none", keepDefault: false }, own, ACTOR, NOW);
    expect((await storeForOwner(query, owner, own, krizaka)).store.describe().kind).toBe("none");
    await saveSettings(query, owner, { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW);
    expect((await storeForOwner(query, owner, own, krizaka)).store.describe().owner).toBe("workspace");
    await expect(storeForOwner(query, owner, null, krizaka)).rejects.toMatchObject({ status: 503, body: { code: "STORAGE_UNAVAILABLE" } });
  });

  describe("the move of the rows that kept their own key (migrateOwnS3)", () => {
    /** A row as ADR-0007 wrote it: the key sealed under the old settings key, the columns filled, no provider. */
    const legacy = async (over: { sealedWith?: Uint8Array; region?: string | null } = {}) => {
      const owner = await account();
      await query(
        `INSERT INTO storage_settings (owner_id, mode, keep_default, s3_endpoint, s3_region, s3_bucket, s3_access_key_id, s3_secret_sealed, tested_at) VALUES ($1, 's3', true, 'https://s3.ca-central-1.amazonaws.com', $2, 'my-docs', 'AKIALEGACY', $3, $4)`,
        [owner, over.region === undefined ? "ca-central-1" : over.region, seal("legacy-secret", over.sealedWith ?? oldKey), NOW],
      );
      return owner;
    };

    it("registers the person's S3 at their scope, re-sealed under the vault, and the documents kept on it name it", async () => {
      const owner = await legacy();
      const result = await migrateOwnS3(query, own, NOW);
      expect(result.moved).toBeGreaterThanOrEqual(1);
      const id = migratedProviderId(owner);
      const record = (await store.get(id))!;
      expect(record).toMatchObject({ scope: userScope(owner), kind: "s3", status: "active", coordinates: { endpoint: "https://s3.ca-central-1.amazonaws.com", region: "ca-central-1", bucket: "my-docs", prefix: "yomizaka" }, keyId: "media-1" });
      expect(record.sealedCredentials.startsWith("v2.media-1.")).toBe(true);
      expect(record.sealedCredentials).not.toContain("legacy-secret");
      expect(await store.defaultFor(userScope(owner), "documents")).toBe(id);
      expect(await sealedInRow(owner)).toBeNull();
      expect((await loadSettings(query, owner)).s3).toMatchObject({ accessKeyId: "AKIALEGACY", hasSecret: true });
      expect((await ownS3Store(query, owner, own))!.describe()).toMatchObject({ owner: "workspace", region: "ca-central-1" });
      expect((await migrateOwnS3(query, own, NOW)).moved).toBe(0);
      expect((await service.list(userScope(owner))).length).toBe(1);
    });

    it("the documents already kept on that S3 name the provider", async () => {
      const owner = await legacy();
      const [doc] = await query<{ id: string }>("INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text, storage, storage_owner) VALUES ($1, 'Lease', 'l.pdf', 'application/pdf', 4, $2, ''::bytea, 'bail', 's3', 'workspace') RETURNING id", [owner, `sha-${owner}`]);
      await migrateOwnS3(query, own, NOW);
      expect((await query<{ provider_id: string }>("SELECT provider_id FROM documents WHERE id = $1", [doc!.id]))[0]!.provider_id).toBe(migratedProviderId(owner));
    });

    it("finishes a move that stopped half-way without adding a second provider", async () => {
      const owner = await legacy();
      await migrateOwnS3(query, own, NOW);
      await query("UPDATE storage_settings SET provider_id = NULL, s3_secret_sealed = $2 WHERE owner_id = $1", [owner, seal("legacy-secret", oldKey)]);
      await migrateOwnS3(query, own, NOW);
      expect((await service.list(userScope(owner))).length).toBe(1);
      expect((await loadSettings(query, owner)).s3?.hasSecret).toBe(true);
      expect(await sealedInRow(owner)).toBeNull();
    });

    it("leaves for a later start a row sealed under a key this deployment no longer holds, or an incomplete one, and says so", async () => {
      const lost = await legacy({ sealedWith: crypto.randomBytes(32) });
      const incomplete = await legacy({ region: null });
      const result = await migrateOwnS3(query, own, NOW);
      expect(result.left).toBeGreaterThanOrEqual(2);
      for (const owner of [lost, incomplete]) {
        expect(await sealedInRow(owner)).not.toBeNull();
        expect(await service.list(userScope(owner))).toEqual([]);
      }
    });
  });
});
