import { type ObjectStore, sealEnvelope } from "@krizaka/storage";
import { type Actor, memoryProviderStore, type ProviderService } from "@krizaka/storage/provider-admin";
import type { QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import { type OwnProviders } from "./own-providers";
import {
  loadSettings,
  ownProviderId,
  ownS3Store,
  saveCloud,
  saveDisconnected,
  saveSettings,
  type SettingsInput,
  storeForOwner,
} from "./settings";

const NOW = new Date("2026-05-06T07:08:09Z");
const ACTOR: Actor = { id: "owner-1", label: "owner@verikora.test" };
const KEY = new Uint8Array(32).fill(3);
const VAULT = { keyId: "k1", key: KEY, ring: { keys: { k1: KEY } } };

interface SettingsRow extends QueryResultRow {
  mode: string;
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

const row = (over: Partial<SettingsRow> = {}): SettingsRow => ({
  mode: "krizaka",
  keep_default: false,
  s3_endpoint: null,
  s3_region: null,
  s3_bucket: null,
  s3_access_key_id: null,
  s3_secret_sealed: null,
  provider_id: null,
  tested_at: null,
  cloud_connector: null,
  ...over,
});

/** A Query over a one-row table: SELECT answers the stored row, every other statement is recorded. */
function fakeQuery(stored?: SettingsRow) {
  const writes: { text: string; values: unknown[] | undefined }[] = [];
  const selects: unknown[][] = [];
  const q = async <T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> => {
    if (text.startsWith("SELECT")) {
      selects.push(values ?? []);
      return (stored ? [stored] : []) as unknown as T[];
    }
    writes.push({ text, values });
    return [];
  };
  return { q, writes, selects };
}

const objects = (): ObjectStore => ({
  put: async () => undefined,
  get: async () => null,
  head: async () => null,
  delete: async () => undefined,
  list: async () => [],
  signedUrl: async () => null,
  publicUrl: () => null,
});

/** The members of the registry's service that saving settings reaches, recording each call. */
function fakeOwn(options: { testStatus?: string; sealedSecret?: string } = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const note =
    <R>(method: string, answer: () => R) =>
    async (...args: unknown[]): Promise<R> => {
      calls.push({ method, args });
      return answer();
    };
  const service = {
    create: note("create", () => ({ id: "new-provider" })),
    test: note("test", () => ({ status: options.testStatus ?? "verified", lastTest: null })),
    setDefault: note("setDefault", () => ({})),
    disable: note("disable", () => ({})),
    changeKey: note("changeKey", () => ({})),
    open: note("open", () => objects()),
  } as unknown as ProviderService;
  const store = memoryProviderStore();
  const own: OwnProviders = { service, store, vault: VAULT };
  return { own, calls, store };
}

const S3 = { endpoint: "https://s3.example", region: "ca-central-1", bucket: "mine", accessKeyId: "AK" };

const refusal = (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (error: { status: number; body: { code?: string } }) => error,
  );

describe("what the page may see of the settings", () => {
  it("is Krizaka's store with nothing kept by default when the owner has no row", async () => {
    const { q, selects } = fakeQuery();
    expect(await loadSettings(q, "o1")).toEqual({
      mode: "krizaka",
      keepDefault: false,
      s3: null,
      cloud: null,
      testedAt: null,
    });
    expect(selects).toEqual([["o1"]]);
  });

  it("shows an own S3 without its secret, only whether one is held (by the registry or still sealed in the row)", async () => {
    const tested = new Date("2026-01-01T00:00:00Z");
    const registered = fakeQuery(
      row({
        mode: "s3",
        s3_endpoint: "e",
        s3_region: "r",
        s3_bucket: "b",
        s3_access_key_id: "ak",
        provider_id: "p",
        tested_at: tested,
      }),
    );
    expect(await loadSettings(registered.q, "o")).toEqual({
      mode: "s3",
      keepDefault: false,
      s3: { endpoint: "e", region: "r", bucket: "b", accessKeyId: "ak", hasSecret: true },
      cloud: null,
      testedAt: tested.toISOString(),
    });
    const legacy = fakeQuery(row({ mode: "s3", s3_endpoint: "e", s3_secret_sealed: "v1.x" }));
    expect((await loadSettings(legacy.q, "o")).s3).toEqual({
      endpoint: "e",
      region: "",
      bucket: "",
      accessKeyId: "",
      hasSecret: true,
    });
    const none = fakeQuery(row({ mode: "s3", s3_endpoint: "e" }));
    expect((await loadSettings(none.q, "o")).s3?.hasSecret).toBe(false);
  });

  it("says a cloud is connected only while the mode is cloud", async () => {
    const connected = fakeQuery(row({ mode: "cloud", cloud_connector: "dropbox", provider_id: "p" }));
    expect((await loadSettings(connected.q, "o")).cloud).toEqual({ connector: "dropbox", connected: true });
    const gone = fakeQuery(row({ mode: "krizaka", cloud_connector: "dropbox", provider_id: "p" }));
    expect((await loadSettings(gone.q, "o")).cloud).toEqual({ connector: "dropbox", connected: false });
  });
});

describe("saving the settings", () => {
  it("refuses keeping by default when keeping is off", async () => {
    const { q, writes } = fakeQuery();
    const error = await refusal(() => saveSettings(q, "o", { mode: "none", keepDefault: true }, null, ACTOR, NOW));
    expect(error?.status).toBe(400);
    expect(error?.body.code).toBe("BAD_REQUEST");
    expect(writes).toEqual([]);
  });

  it("upserts the mode and the default for a mode that is not S3, and answers the saved view", async () => {
    const { q, writes } = fakeQuery(row({ mode: "none" }));
    const saved = await saveSettings(q, "o1", { mode: "none", keepDefault: false }, null, ACTOR, NOW);
    expect(saved.mode).toBe("none");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toContain("INSERT INTO storage_settings");
    expect(writes[0]?.values).toEqual(["o1", "none", false, NOW]);
  });

  it.each([
    ["endpoint", { ...S3, endpoint: "" }],
    ["region", { ...S3, region: "" }],
    ["bucket", { ...S3, bucket: "" }],
    ["access key", { ...S3, accessKeyId: "" }],
  ])("wants the %s of an S3", async (_name, s3) => {
    const { own } = fakeOwn();
    const { q, writes } = fakeQuery();
    const error = await refusal(() => saveSettings(q, "o", { mode: "s3", keepDefault: true, s3 }, own, ACTOR, NOW));
    expect(error?.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("wants S3 fields at all, and a deployment that can store credentials", async () => {
    const { q } = fakeQuery();
    expect(
      (await refusal(() => saveSettings(q, "o", { mode: "s3", keepDefault: false }, null, ACTOR, NOW)))?.status,
    ).toBe(400);
    const error = await refusal(() =>
      saveSettings(q, "o", { mode: "s3", keepDefault: false, s3: { ...S3, secretAccessKey: "SK" } }, null, ACTOR, NOW),
    );
    expect(error?.status).toBe(503);
    expect(error?.body.code).toBe("SETTINGS_KEY_MISSING");
  });

  it("registers a new bucket in the registry and stores the provider id, never the secret", async () => {
    const { own, calls } = fakeOwn();
    const { q, writes } = fakeQuery();
    const input: SettingsInput = { mode: "s3", keepDefault: true, s3: { ...S3, secretAccessKey: "SK" } };
    await saveSettings(q, "o1", input, own, ACTOR, NOW);
    expect(calls.map((c) => c.method)).toEqual(["create", "test", "setDefault"]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toEqual([
      "o1",
      true,
      S3.endpoint,
      S3.region,
      S3.bucket,
      S3.accessKeyId,
      "new-provider",
      NOW,
    ]);
    expect(JSON.stringify(writes)).not.toContain("SK");
  });

  it("needs a secret for a new bucket when none is stored", async () => {
    const { own, calls } = fakeOwn();
    const { q, writes } = fakeQuery();
    const error = await refusal(() =>
      saveSettings(q, "o", { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW),
    );
    expect(error?.status).toBe(400);
    expect(error?.body.code).toBe("BAD_REQUEST");
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("changes nothing in the registry when the same bucket and key are saved again", async () => {
    const { own, calls } = fakeOwn();
    const existing = row({
      mode: "s3",
      s3_endpoint: S3.endpoint,
      s3_region: S3.region,
      s3_bucket: S3.bucket,
      s3_access_key_id: S3.accessKeyId,
      provider_id: "p-old",
    });
    const { q, writes } = fakeQuery(existing);
    await saveSettings(q, "o1", { mode: "s3", keepDefault: false, s3: S3 }, own, ACTOR, NOW);
    expect(calls).toEqual([]);
    expect((writes[0]?.values as unknown[])[6]).toBe("p-old");
  });

  it("tests new keys for the same bucket through the registry, reusing the stored secret when none is typed", async () => {
    const { own, calls, store } = fakeOwn();
    await store.insert({
      id: "p-old",
      scope: "user:o1",
      kind: "s3",
      preset: null,
      label: "x",
      coordinates: {},
      sealedCredentials: sealEnvelope(JSON.stringify({ accessKeyId: "AK", secretAccessKey: "STORED" }), KEY, "k1"),
      keyId: "k1",
      status: "active",
      source: "admin",
      lastTest: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const existing = row({
      mode: "s3",
      s3_endpoint: S3.endpoint,
      s3_region: S3.region,
      s3_bucket: S3.bucket,
      s3_access_key_id: "AK",
      provider_id: "p-old",
    });
    const { q, writes } = fakeQuery(existing);
    await saveSettings(q, "o1", { mode: "s3", keepDefault: false, s3: { ...S3, accessKeyId: "AK2" } }, own, ACTOR, NOW);
    expect(calls).toEqual([
      { method: "changeKey", args: [ACTOR, "p-old", { accessKeyId: "AK2", secretAccessKey: "STORED" }] },
    ]);
    expect((writes[0]?.values as unknown[])[6]).toBe("p-old");
  });

  it("registers a new provider for another bucket and disables the one it replaces, even if that fails", async () => {
    const { own, calls } = fakeOwn();
    const failing = own.service as unknown as { disable: () => Promise<never> };
    failing.disable = async () => {
      throw new Error("still referenced");
    };
    const existing = row({
      mode: "s3",
      s3_endpoint: S3.endpoint,
      s3_region: S3.region,
      s3_bucket: "other-bucket",
      s3_access_key_id: "AK",
      provider_id: "p-old",
    });
    const { q, writes } = fakeQuery(existing);
    await saveSettings(
      q,
      "o1",
      { mode: "s3", keepDefault: false, s3: { ...S3, secretAccessKey: "SK" } },
      own,
      ACTOR,
      NOW,
    );
    expect(calls.map((c) => c.method)).toEqual(["create", "test", "setDefault"]);
    expect((writes[0]?.values as unknown[])[6]).toBe("new-provider");
  });

  it("does not store a bucket whose connection test is red", async () => {
    const { own } = fakeOwn({ testStatus: "failed" });
    const { q, writes } = fakeQuery();
    const error = await refusal(() =>
      saveSettings(q, "o", { mode: "s3", keepDefault: false, s3: { ...S3, secretAccessKey: "SK" } }, own, ACTOR, NOW),
    );
    expect(error?.body.code).toBe("CONNECTION_FAILED");
    expect(writes).toEqual([]);
  });
});

describe("connecting and disconnecting a cloud", () => {
  it("saves a connected cloud as the place documents go, keeping nothing by default", async () => {
    const { q, writes } = fakeQuery(row({ mode: "cloud", cloud_connector: "dropbox", provider_id: "p1" }));
    const saved = await saveCloud(q, "o1", "dropbox", "p1", NOW);
    expect(writes[0]?.values).toEqual(["o1", "dropbox", "p1", NOW]);
    expect(writes[0]?.text).toContain("'cloud', false");
    expect(saved.cloud).toEqual({ connector: "dropbox", connected: true });
  });

  it("goes back to Krizaka's store on a disconnect, only from the cloud mode", async () => {
    const { q, writes } = fakeQuery(row({ mode: "krizaka", cloud_connector: "dropbox", provider_id: "p1" }));
    const saved = await saveDisconnected(q, "o1", NOW);
    expect(writes[0]?.text).toContain("mode = 'krizaka'");
    expect(writes[0]?.text).toContain("AND mode = 'cloud'");
    expect(writes[0]?.values).toEqual(["o1", NOW]);
    expect(saved.cloud).toEqual({ connector: "dropbox", connected: false });
  });

  it("names the provider and the connector of an owner, or nothing", async () => {
    expect(await ownProviderId(fakeQuery().q, "o")).toEqual({ providerId: null, connector: null });
    const { q } = fakeQuery(row({ provider_id: "p1", cloud_connector: "dropbox" }));
    expect(await ownProviderId(q, "o")).toEqual({ providerId: "p1", connector: "dropbox" });
  });
});

describe("the owner's own cloud as a store", () => {
  const { own, calls } = fakeOwn();

  it("is null when the owner has no settings", async () => {
    expect(await ownS3Store(fakeQuery().q, "o", own)).toBeNull();
  });

  it("answers a disconnect (STORAGE_DISCONNECTED) for a cloud that was connected and is not now", async () => {
    const { q } = fakeQuery(row({ mode: "krizaka", cloud_connector: "dropbox", provider_id: "p" }));
    const store = await ownS3Store(q, "o", own);
    const error = await refusal(() => store!.get("a/b/c.pdf"));
    expect(error?.status).toBe(409);
    expect(error?.body.code).toBe("STORAGE_DISCONNECTED");
  });

  it("opens a connected cloud by its provider, and is null without a provider or without the registry", async () => {
    const connected = fakeQuery(row({ mode: "cloud", cloud_connector: "dropbox", provider_id: "p9" }));
    const store = await ownS3Store(connected.q, "o", own);
    expect(store?.describe()).toMatchObject({ kind: "cloud", endpoint: "dropbox" });
    expect(calls.at(-1)).toEqual({ method: "open", args: ["p9"] });
    expect(await ownS3Store(connected.q, "o", null)).toBeNull();
    const noProvider = fakeQuery(row({ mode: "cloud", cloud_connector: "dropbox" }));
    expect(await ownS3Store(noProvider.q, "o", own)).toBeNull();
  });

  it("opens an own S3 by its provider, described with its endpoint and region, and is null when something is missing", async () => {
    const s3 = fakeQuery(
      row({ mode: "s3", s3_endpoint: "https://s3.example", s3_region: "ca-central-1", provider_id: "p2" }),
    );
    const store = await ownS3Store(s3.q, "o", own);
    expect(store?.describe()).toMatchObject({ kind: "s3", region: "ca-central-1" });
    expect(await ownS3Store(s3.q, "o", null)).toBeNull();
    expect(await ownS3Store(fakeQuery(row({ mode: "s3", s3_endpoint: "e" })).q, "o", own)).toBeNull();
    expect(await ownS3Store(fakeQuery(row({ mode: "s3", provider_id: "p" })).q, "o", own)).toBeNull();
    expect(await ownS3Store(fakeQuery(row({ mode: "krizaka", provider_id: "p" })).q, "o", own)).toBeNull();
  });
});

describe("the store an owner's documents use", () => {
  const { own } = fakeOwn();
  const krizaka = {
    put: async () => undefined,
    get: async () => null,
    signedUrl: async () => null,
    delete: async () => undefined,
    describe: () => ({
      kind: "bunny" as const,
      endpoint: "k",
      region: null,
      residency: "canada" as const,
      encrypted: false,
      owner: "krizaka" as const,
      devOnly: false,
    }),
  };

  it("is nothing when keeping is off", async () => {
    const { store, settings } = await storeForOwner(fakeQuery(row({ mode: "none" })).q, "o", own, krizaka);
    expect(settings.mode).toBe("none");
    expect(store).not.toBe(krizaka);
    expect(store.describe().kind).toBe("none");
  });

  it("is the deployment's own store for Krizaka mode and for an owner with no row", async () => {
    expect((await storeForOwner(fakeQuery().q, "o", own, krizaka)).store).toBe(krizaka);
    expect((await storeForOwner(fakeQuery(row()).q, "o", own, krizaka)).store).toBe(krizaka);
  });

  it("is the owner's own cloud in S3 and cloud modes, and 503 when it cannot be opened", async () => {
    const s3 = fakeQuery(row({ mode: "s3", s3_endpoint: "https://s3.example", s3_region: "r", provider_id: "p" }));
    expect((await storeForOwner(s3.q, "o", own, krizaka)).store.describe().kind).toBe("s3");
    const cloud = fakeQuery(row({ mode: "cloud", cloud_connector: "dropbox", provider_id: "p" }));
    expect((await storeForOwner(cloud.q, "o", own, krizaka)).store.describe().kind).toBe("cloud");
    const error = await refusal(() => storeForOwner(s3.q, "o", null, krizaka));
    expect(error?.status).toBe(503);
    expect(error?.body.code).toBe("STORAGE_UNAVAILABLE");
  });
});
