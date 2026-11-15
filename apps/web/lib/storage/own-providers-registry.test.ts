import { type ObjectStore, openEnvelope, sealEnvelope, STORAGE_CODE, StorageError } from "@krizaka/storage";
import { type Actor, memoryProviderStore, type ProviderService } from "@krizaka/storage/provider-admin";
import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import {
  cloudBucketStore,
  disconnectedStore,
  forgetGrant,
  migratedProviderId,
  migrateOwnS3,
  OWN_PREFIX,
  ownBucketStore,
  registerCloud,
  registerOwnS3,
  replaceOwnS3Key,
  storedRefreshToken,
  storedSecret,
  userScope,
} from "./own-providers";

const ACTOR: Actor = { id: "admin-1", label: "admin@verikora.test" };
const NOW = new Date("2026-03-04T05:06:07Z");
const KEY = new Uint8Array(32).fill(7);
const VAULT = { keyId: "k1", key: KEY, ring: { keys: { k1: KEY } } };
const DOC_KEY = "owner-1/doc-1/original.pdf";

interface Call {
  method: string;
  args: unknown[];
}

/** A provider service that records what it is asked and answers what the test says: only the members the module under test uses. */
function fakeService(options: { testStatus?: string; changeKey?: () => Promise<unknown>; objects?: ObjectStore } = {}) {
  const calls: Call[] = [];
  const note =
    <R>(method: string, answer: () => R) =>
    async (...args: unknown[]): Promise<R> => {
      calls.push({ method, args });
      return answer();
    };
  const service = {
    create: note("create", () => ({ id: "provider-1" })),
    test: note("test", () => ({
      status: options.testStatus ?? "verified",
      lastTest: { steps: [{ name: "write", ok: false }] },
    })),
    setDefault: note("setDefault", () => ({})),
    disable: note("disable", () => ({})),
    changeKey: async (...args: unknown[]) => {
      calls.push({ method: "changeKey", args });
      return options.changeKey ? options.changeKey() : {};
    },
    open: note("open", () => options.objects),
  } as unknown as ProviderService;
  return { service, calls };
}

const fakeObjects = (): ObjectStore & { puts: string[] } => {
  const puts: string[] = [];
  return {
    puts,
    put: async (key) => void puts.push(key),
    get: async () => null,
    head: async () => null,
    delete: async () => undefined,
    list: async () => [],
    signedUrl: async (key, ttl) => `https://signed.test/${key}?ttl=${ttl}`,
    publicUrl: () => null,
  };
};

const refusal = (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (error: { status: number; body: { code?: string; steps?: unknown } }) => error,
  );

describe("who a provider belongs to", () => {
  it("scopes a person's provider by their id", () => {
    expect(userScope("abc")).toBe("user:abc");
  });

  it("gives a person the same migrated provider id every time, shaped as a v4-looking uuid, and another person another one", () => {
    const id = migratedProviderId("owner-1");
    expect(id).toBe(migratedProviderId("owner-1"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(migratedProviderId("owner-2")).not.toBe(id);
  });
});

describe("registering a person's own S3", () => {
  const s3 = {
    endpoint: "https://s3.example",
    region: "ca-central-1",
    bucket: "mine",
    accessKeyId: "AK",
    secretAccessKey: "SK",
  };

  it("creates it at user scope under the product's prefix, tests it, and makes it the default of their documents", async () => {
    const { service, calls } = fakeService();
    const id = await registerOwnS3({ service }, ACTOR, "owner-1", s3);
    expect(id).toBe("provider-1");
    expect(calls.map((c) => c.method)).toEqual(["create", "test", "setDefault"]);
    expect(calls[0]?.args[1]).toEqual({
      scope: "user:owner-1",
      kind: "s3",
      preset: "generic",
      label: "My S3",
      coordinates: { endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, prefix: OWN_PREFIX },
      credentials: { accessKeyId: "AK", secretAccessKey: "SK" },
    });
    expect(calls[2]?.args.slice(1)).toEqual(["provider-1", "user:owner-1", "documents"]);
  });

  it("leaves nothing in use when the test is red: disabled, refused with the steps, never made the default", async () => {
    const { service, calls } = fakeService({ testStatus: "failed" });
    const error = await refusal(() => registerOwnS3({ service }, ACTOR, "owner-1", s3));
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("CONNECTION_FAILED");
    expect(error?.body.steps).toEqual([{ name: "write", ok: false }]);
    expect(calls.map((c) => c.method)).toEqual(["create", "test", "disable"]);
  });
});

describe("new keys for the same bucket", () => {
  it("passes them to the registry, which tests them first", async () => {
    const { service, calls } = fakeService();
    await replaceOwnS3Key({ service }, ACTOR, "p1", { accessKeyId: "AK2", secretAccessKey: "SK2" });
    expect(calls).toEqual([
      { method: "changeKey", args: [ACTOR, "p1", { accessKeyId: "AK2", secretAccessKey: "SK2" }] },
    ]);
  });

  it("says the connection test failed when the registry refuses them", async () => {
    const { service } = fakeService({
      changeKey: async () => {
        throw new StorageError(STORAGE_CODE.provider, "denied");
      },
    });
    const error = await refusal(() =>
      replaceOwnS3Key({ service }, ACTOR, "p1", { accessKeyId: "a", secretAccessKey: "b" }),
    );
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("CONNECTION_FAILED");
  });

  it("does not hide a failure that is not the registry's refusal", async () => {
    const boom = new Error("db down");
    const { service } = fakeService({
      changeKey: async () => {
        throw boom;
      },
    });
    await expect(replaceOwnS3Key({ service }, ACTOR, "p1", { accessKeyId: "a", secretAccessKey: "b" })).rejects.toBe(
      boom,
    );
  });
});

const sealed = (credentials: Record<string, string>) => sealEnvelope(JSON.stringify(credentials), KEY, "k1");

const recordOf = (id: string, credentials: Record<string, string>) => ({
  id,
  scope: userScope("o"),
  kind: "s3",
  preset: null,
  label: "x",
  coordinates: {},
  sealedCredentials: sealed(credentials),
  keyId: "k1",
  status: "active" as const,
  source: "admin" as const,
  lastTest: null,
  createdBy: null,
  createdAt: NOW,
  updatedAt: NOW,
});

describe("reading back what a person saved", () => {
  it("opens the secret access key, and says null when there is no provider, no id, or no secret in it", async () => {
    const store = memoryProviderStore();
    await store.insert(recordOf("with", { accessKeyId: "AK", secretAccessKey: "SK" }));
    await store.insert(recordOf("without", { accessKeyId: "AK" }));
    expect(await storedSecret({ store, vault: VAULT }, "with")).toBe("SK");
    expect(await storedSecret({ store, vault: VAULT }, "without")).toBeNull();
    expect(await storedSecret({ store, vault: VAULT }, "missing")).toBeNull();
    expect(await storedSecret({ store, vault: VAULT }, null)).toBeNull();
  });

  it("opens the refresh token of a connected cloud, and says null when it holds none", async () => {
    const store = memoryProviderStore();
    await store.insert(recordOf("cloud", { refreshToken: "RT" }));
    await store.insert(recordOf("empty", {}));
    expect(await storedRefreshToken({ store, vault: VAULT }, "cloud")).toBe("RT");
    expect(await storedRefreshToken({ store, vault: VAULT }, "empty")).toBeNull();
    expect(await storedRefreshToken({ store, vault: VAULT }, "missing")).toBeNull();
    expect(await storedRefreshToken({ store, vault: VAULT }, null)).toBeNull();
  });

  it("forgets a grant: the provider is disabled and its sealed credentials open to nothing", async () => {
    const store = memoryProviderStore();
    await store.insert(recordOf("cloud", { refreshToken: "RT" }));
    await forgetGrant({ store, vault: VAULT }, "cloud", new Date("2026-04-01T00:00:00Z"));
    const after = await store.get("cloud");
    expect(after?.status).toBe("disabled");
    expect(after?.updatedAt).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(JSON.parse(openEnvelope(after!.sealedCredentials, VAULT.ring))).toEqual({});
    expect(await storedRefreshToken({ store, vault: VAULT }, "cloud")).toBeNull();
  });
});

describe("a person's bucket as a store", () => {
  it("says it is theirs and where, and writes through the registry's opened store", async () => {
    const objects = fakeObjects();
    const { service, calls } = fakeService({ objects });
    const store = await ownBucketStore({ service }, "p1", {
      endpoint: "https://s3.ca-central-1.example",
      region: "ca-central-1",
    });
    expect(calls).toEqual([{ method: "open", args: ["p1"] }]);
    expect(store.describe()).toMatchObject({
      kind: "s3",
      region: "ca-central-1",
      owner: "workspace",
      encrypted: false,
    });
    await store.put(DOC_KEY, new Uint8Array([1]), { contentType: "application/pdf" });
    expect(objects.puts).toEqual([DOC_KEY]);
  });

  it("never signs a link for longer than the product allows", async () => {
    const { service } = fakeService({ objects: fakeObjects() });
    const store = await ownBucketStore({ service }, "p1", { endpoint: "https://s3.example", region: "r" });
    const url = await store.signedUrl(DOC_KEY, 86_400);
    expect(url).toContain("ttl=900");
  });
});

describe("a connected cloud as a store", () => {
  it("names the connector in its descriptor", async () => {
    const { service } = fakeService({ objects: fakeObjects() });
    const store = await cloudBucketStore({ service }, "p1", "dropbox");
    expect(store.describe()).toEqual({
      kind: "cloud",
      endpoint: "dropbox",
      region: null,
      residency: "unknown",
      encrypted: false,
      owner: "workspace",
      devOnly: false,
    });
  });

  it("is registered with the grant sealed as credentials, a client secret only when there is one", async () => {
    const withSecret = fakeService();
    const id = await registerCloud({ service: withSecret.service }, ACTOR, "o1", {
      connector: "dropbox",
      clientId: "cid",
      clientSecret: "csecret",
      refreshToken: "rt",
    });
    expect(id).toBe("provider-1");
    expect(withSecret.calls[0]?.args[1]).toEqual({
      scope: "user:o1",
      kind: "dropbox",
      label: "My dropbox",
      coordinates: { clientId: "cid", prefix: OWN_PREFIX },
      credentials: { refreshToken: "rt", clientSecret: "csecret" },
    });
    expect(withSecret.calls.map((c) => c.method)).toEqual(["create", "test", "setDefault"]);

    const withoutSecret = fakeService();
    await registerCloud({ service: withoutSecret.service }, ACTOR, "o1", {
      connector: "gdrive",
      clientId: "cid",
      clientSecret: null,
      refreshToken: "rt",
    });
    expect((withoutSecret.calls[0]?.args[1] as { credentials: unknown }).credentials).toEqual({ refreshToken: "rt" });
  });

  it("leaves nothing in use when the cloud's test is red", async () => {
    const { service, calls } = fakeService({ testStatus: "failed" });
    const error = await refusal(() =>
      registerCloud({ service }, ACTOR, "o1", {
        connector: "dropbox",
        clientId: "c",
        clientSecret: null,
        refreshToken: "r",
      }),
    );
    expect(error?.body.code).toBe("CONNECTION_FAILED");
    expect(calls.map((c) => c.method)).toEqual(["create", "test", "disable"]);
  });
});

describe("a cloud the person disconnected", () => {
  it("answers STORAGE_DISCONNECTED (409) to a read, a write and a link, but a delete is a no-op", async () => {
    const store = disconnectedStore("dropbox");
    for (const attempt of [
      () => store.get(DOC_KEY),
      () => store.put(DOC_KEY, new Uint8Array(), { contentType: "application/pdf" }),
      () => store.signedUrl(DOC_KEY, 60),
    ]) {
      const error = await refusal(attempt);
      expect(error?.status).toBe(409);
      expect(error?.body.code).toBe("STORAGE_DISCONNECTED");
    }
    await expect(store.delete(DOC_KEY)).resolves.toBeUndefined();
    expect(store.describe()).toMatchObject({ kind: "cloud", endpoint: "dropbox" });
  });
});

interface LegacyRow extends QueryResultRow {
  owner_id: string;
  s3_endpoint: string;
  s3_region: string | null;
  s3_bucket: string | null;
  s3_access_key_id: string | null;
  s3_secret_sealed: string;
  tested_at: Date | null;
}

const legacy = (owner: string, over: Partial<LegacyRow> = {}): LegacyRow => ({
  owner_id: owner,
  s3_endpoint: "https://s3.example",
  s3_region: "ca-central-1",
  s3_bucket: "bucket",
  s3_access_key_id: "AK",
  s3_secret_sealed: sealEnvelope("SK", KEY, "k1"),
  tested_at: null,
  ...over,
});

function recordingQuery(rows: LegacyRow[]) {
  const writes: { text: string; values: unknown[] | undefined }[] = [];
  const q = async <T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> => {
    if (text.includes("FROM storage_settings")) {
      return rows as unknown as T[];
    }
    writes.push({ text, values });
    return [];
  };
  return { q, writes };
}

describe("moving the settings rows that kept their own secret into the registry", () => {
  it("moves a complete row: re-sealed provider, default of that person's documents, the documents and the row name it, the secret forgotten", async () => {
    const store = memoryProviderStore();
    const { q, writes } = recordingQuery([legacy("owner-1")]);
    const result = await migrateOwnS3(q, { store, vault: VAULT }, NOW);
    expect(result).toEqual({ moved: 1, left: 0 });
    const id = migratedProviderId("owner-1");
    const record = await store.get(id);
    expect(record).toMatchObject({
      scope: "user:owner-1",
      kind: "s3",
      status: "active",
      keyId: "k1",
      coordinates: { endpoint: "https://s3.example", region: "ca-central-1", bucket: "bucket", prefix: OWN_PREFIX },
      createdBy: "owner-1",
    });
    expect(JSON.parse(openEnvelope(record!.sealedCredentials, VAULT.ring))).toEqual({
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    expect(await store.defaultFor("user:owner-1", "documents")).toBe(id);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.text).toContain("UPDATE documents SET provider_id");
    expect(writes[0]?.values).toEqual([id, "owner-1"]);
    expect(writes[1]?.text).toContain("s3_secret_sealed = NULL");
    expect(writes[1]?.values).toEqual([id, "owner-1"]);
  });

  it("counts as left a row that is incomplete or sealed under a key this deployment no longer holds, and moves the others", async () => {
    const otherKey = new Uint8Array(32).fill(9);
    const store = memoryProviderStore();
    const { q, writes } = recordingQuery([
      legacy("a", { s3_region: null }),
      legacy("b", { s3_bucket: null }),
      legacy("c", { s3_access_key_id: null }),
      legacy("d", { s3_secret_sealed: sealEnvelope("SK", otherKey, "gone") }),
      legacy("e"),
    ]);
    const result = await migrateOwnS3(q, { store, vault: VAULT }, NOW);
    expect(result).toEqual({ moved: 1, left: 4 });
    expect(writes.every((w) => (w.values as unknown[])[1] === "e")).toBe(true);
    expect(await store.get(migratedProviderId("a"))).toBeNull();
  });

  it("is idempotent for a provider a half-done start already wrote: it is not inserted twice", async () => {
    const store = memoryProviderStore();
    const { q } = recordingQuery([legacy("owner-1")]);
    await migrateOwnS3(q, { store, vault: VAULT }, NOW);
    const first = await store.get(migratedProviderId("owner-1"));
    await migrateOwnS3(q, { store, vault: VAULT }, new Date("2027-01-01T00:00:00Z"));
    expect((await store.get(migratedProviderId("owner-1")))?.createdAt).toEqual(first?.createdAt);
    expect(await store.list("user:owner-1")).toHaveLength(1);
  });

  it("has nothing to do when no row keeps its own secret", async () => {
    const { q, writes } = recordingQuery([]);
    expect(await migrateOwnS3(q, { store: memoryProviderStore(), vault: VAULT }, NOW)).toEqual({ moved: 0, left: 0 });
    expect(writes).toEqual([]);
  });
});
