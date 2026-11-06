import { createProviderService, memoryProviderStore } from "@krizaka/storage/provider-admin";
import { describe, expect, it } from "vitest";

import {
  addProvider,
  adminKinds,
  assertDefaultResidency,
  changeKeyInput,
  createProviderInput,
  guarded,
  overview,
  setDefaultInput,
  storageRefusal,
} from "./admin-api";

const ADMIN = { id: "a1", label: "admin@x.test" };
const SECRET = "super-secret-zone-password";

/** A Bunny-shaped zone in memory: PUT stores, GET returns, DELETE removes; every call answers `failWith` instead when set. */
function zone(failWith = 0) {
  const objects = new Map<string, Uint8Array>();
  return async (url: string, init?: RequestInit) => {
    if (failWith) {
      return new Response("no", { status: failWith });
    }
    const method = init?.method ?? "GET";
    if (method === "PUT") {
      objects.set(url, new Uint8Array(init?.body as ArrayBuffer));
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") {
      return new Response(null, { status: objects.delete(url) ? 200 : 404 });
    }
    const found = objects.get(url);
    return found ? new Response(found as BodyInit, { status: 200 }) : new Response("missing", { status: 404 });
  };
}

function harness(fetchStatus = 0) {
  const store = memoryProviderStore();
  const notes: { action: string; detail: unknown }[] = [];
  let n = 0;
  const service = createProviderService({
    store,
    vault: { keyId: "media-1", key: Buffer.alloc(32, 1), ring: { keys: { "media-1": Buffer.alloc(32, 1) } } },
    clock: { now: () => new Date("2026-10-28T12:00:00Z") },
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    audit: async (note) => void notes.push({ action: note.action, detail: note.detail }),
    open: {
      runtime: "dev",
      environment: "dev",
      fetch: zone(fetchStatus) as never,
      clock: { now: () => new Date("2026-10-28T12:00:00Z") },
    },
    probeId: () => "probe",
    references: async () => 0,
  });
  return { store, service, notes };
}

const bunny = createProviderInput.parse({
  kind: "bunny",
  label: "Dev zone",
  coordinates: { endpoint: "storage.bunnycdn.com", zone: "yomizaka-docs-dev" },
  credentials: { accessKey: SECRET },
});

describe("the kinds the form offers", () => {
  it("hide a dev-only kind in production, and offer only what an admin can open", () => {
    expect(
      adminKinds("server", "dev")
        .map((k) => k.kind)
        .sort(),
    ).toEqual(["azblob", "b2", "bunny", "gcs", "s3", "webdav"]);
    expect(
      adminKinds("server", "prod")
        .map((k) => k.kind)
        .sort(),
    ).toEqual(["azblob", "b2", "gcs", "s3", "webdav"]);
    expect(adminKinds("server", "dev").map((k) => k.kind)).not.toContain("folder");
    expect(adminKinds("dev", "dev").map((k) => k.kind)).not.toContain("device");
  });
  it("carry the field names only, so no value can ride along", () => {
    for (const kind of adminKinds("server", "dev")) {
      expect(JSON.stringify(kind).replaceAll(/"name":"[^"]*"/g, "")).not.toMatch(/secret-|password/);
    }
  });
});

describe("adding a provider", () => {
  it("tests it at once, generates the object-encryption key and returns no secret, ever", async () => {
    const { service, notes } = harness();
    const added = await addProvider(service, ADMIN, bunny);
    expect(added.status).toBe("verified");
    expect(added.credentials).toEqual({ accessKey: "set", tokenKey: "not set", encryptionKey: "set" });
    const everything = JSON.stringify([added, await overview(service, async () => ({}), []), notes]);
    expect(everything).not.toContain(SECRET);
    expect(notes.map((x) => x.action)).toEqual(["storage.provider_created", "storage.provider_tested"]);
    expect(JSON.stringify(notes[0]!.detail)).toContain('"accessKey":"changed"');
  });
  it("stays a draft when the test fails", async () => {
    const { service } = harness(500);
    expect((await addProvider(service, ADMIN, bunny)).status).toBe("draft");
  });
  it("refuses a field the kind does not have, with a 400 and a code", async () => {
    const { service } = harness();
    const bad = createProviderInput.parse({ ...bunny, coordinates: { ...bunny.coordinates, bucket: "nope" } });
    await expect(guarded(() => addProvider(service, ADMIN, bad))).rejects.toMatchObject({
      status: 400,
      body: { code: "STORAGE_BAD_CONFIG" },
    });
  });
  it("refuses a test-less default: only a verified provider can become one (409)", async () => {
    const { service } = harness(500);
    const draft = await addProvider(service, ADMIN, bunny);
    await expect(guarded(() => service.setDefault(ADMIN, draft.id, "org", "documents"))).rejects.toMatchObject({
      status: 409,
      body: { code: "STORAGE_PROVIDER_NOT_VERIFIED" },
    });
  });
});

describe("changing a key", () => {
  it("never accepts the object-encryption key (the stored objects would no longer open) nor an empty change", () => {
    expect(changeKeyInput.safeParse({ credentials: { encryptionKey: "x" } }).success).toBe(false);
    expect(changeKeyInput.safeParse({ credentials: {} }).success).toBe(false);
    expect(changeKeyInput.safeParse({ credentials: { accessKey: "new" } }).success).toBe(true);
  });
  it("is tested first: a failing key is refused (422) and nothing is saved", async () => {
    const ok = harness();
    const added = await addProvider(ok.service, ADMIN, bunny);
    const failing = harness(500);
    const draft = await addProvider(failing.service, ADMIN, bunny);
    await expect(guarded(() => failing.service.changeKey(ADMIN, draft.id, { accessKey: "new" }))).rejects.toMatchObject(
      { status: 422 },
    );
    expect(added.id).toBeTruthy();
  });
});

describe("a refusal of something else is not hidden", () => {
  it("is passed on as it is", async () => {
    expect(storageRefusal(new Error("boom"))).toBeNull();
    await expect(guarded(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

describe("a production default for the documents must be in Canada (verikora#524, Loi 25 art. 17)", () => {
  const tested = (key: string, ok = true) =>
    ({ id: "p1", dataKind: "documents", lastTest: { ok, residency: { key } } }) as never;

  it("lets a tested Canadian provider become the default in production", () => {
    for (const key of ["canada-on", "canada-qc", "canada-ab", "canada"]) {
      expect(() => assertDefaultResidency("prod", tested(key), "documents")).not.toThrow();
    }
  });
  it("refuses an untested, failed, foreign or unknown one in production, in words", () => {
    for (const bad of [
      { id: "p1", lastTest: null },
      tested("elsewhere"),
      tested("unknown"),
      tested("user-cloud"),
      tested("canada-on", false),
    ]) {
      expect(() => assertDefaultResidency("prod", bad as never, "documents")).toThrow(
        expect.objectContaining({ status: 409, body: expect.objectContaining({ code: "STORAGE_NOT_IN_CANADA" }) }),
      );
    }
  });
  it("leaves development free (fictional data only) and the avatars alone", () => {
    expect(() => assertDefaultResidency("dev", tested("elsewhere"), "documents")).not.toThrow();
    expect(() => assertDefaultResidency("prod", tested("elsewhere"), "avatars")).not.toThrow();
  });
});

describe("the data kinds an admin can make a default for", () => {
  it("includes the nightly backups (a second, independent place, #513) and refuses an unknown kind", () => {
    expect(setDefaultInput.safeParse({ dataKind: "backups" }).success).toBe(true);
    expect(setDefaultInput.safeParse({ dataKind: "documents" }).success).toBe(true);
    expect(setDefaultInput.safeParse({ dataKind: "secrets" }).success).toBe(false);
  });
});
