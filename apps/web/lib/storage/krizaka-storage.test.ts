import crypto from "node:crypto";

import { bucketStore, encryptedStore, type FetchLike, remoteStore } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { objectKey } from "../retention";
import { documentStoreOver } from "./adapter";
import { documentStoreContract } from "./contract.testkit";
import { fakeBucket } from "./fake-bucket.testkit";
import { MAX_SIGNED_URL_SECONDS } from "./providers";
import { asDescriptor } from "./where";

/**
 * Verikora keeps its documents through `@krizaka/storage` (ADR-010, verikora#445; the store is chosen by the provider registry, ADR-005):
 * same keys, same links as before the swap, and the personal-data rules (encrypted at rest, short-lived links, purge) still hold. A fake S3
 * and a fake Bunny zone record every request; the stores are the package's own, behind this product's `documentStoreOver`.
 */
const NOW = new Date("2026-10-27T12:00:00Z");
const clock = { now: () => NOW };
const KEY = objectKey(
  "0f1e2d3c-aaaa-4bbb-8ccc-111122223333",
  "9a8b7c6d-dddd-4eee-8fff-444455556666",
  "application/pdf",
);
const DESCRIPTOR = asDescriptor({
  kind: "s3",
  endpoint: "tor1.digitaloceanspaces.com",
  region: "tor1",
  residency: "canada",
  encrypted: false,
  owner: "krizaka",
  devOnly: false,
});

const s3 = (fetch: FetchLike) =>
  bucketStore({
    endpoint: "https://tor1.digitaloceanspaces.com",
    region: "tor1",
    bucket: "verikora-documents",
    accessKeyId: "id",
    secretAccessKey: "fake-credential",
    prefix: "verikora",
    fetch,
    clock,
  });
const documents = (objects: ReturnType<typeof s3>) => documentStoreOver(objects, DESCRIPTOR, MAX_SIGNED_URL_SECONDS);
const encrypted = () => encryptedStore;

describe("the adapters pass the contract of a document store", () => {
  const bucket = fakeBucket();
  documentStoreContract("bucketStore(s3)", () => documents(s3(bucket.fetchLike)));
  documentStoreContract("bucketStore(s3) + encryption", () =>
    documents(encrypted()(s3(bucket.fetchLike), crypto.randomBytes(32))),
  );
});

describe("documents kept before the swap stay readable", () => {
  it("reads an object stored under the old key layout (bucket/prefix/owner/document/original.ext), signed", async () => {
    const bucket = fakeBucket();
    const body = new TextEncoder().encode("%PDF-1.7 bail");
    // What the previous module wrote: path-style URL, the deployment's prefix, the app's key.
    bucket.objects.set(`https://tor1.digitaloceanspaces.com/verikora-documents/verikora/${KEY}`, {
      bytes: body,
      contentType: "application/pdf",
    });
    const store = documents(s3(bucket.fetchLike));
    expect(await store.get(KEY)).toEqual({ bytes: body, contentType: "application/pdf" });
    expect(bucket.calls.every((c) => c.signed)).toBe(true);
  });

  it("reads an object of the Bunny zone at the same path, and hands out the same link shape", async () => {
    const seen: string[] = [];
    const zone: FetchLike = async (url, init) => {
      seen.push(`${init.method} ${new URL(url).pathname}`);
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/pdf" },
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
        text: async () => "",
      };
    };
    const objects = remoteStore({
      endpoint: "storage.bunnycdn.com",
      zone: "krizaka-assets",
      accessKey: "fake-zone-credential",
      prefix: "verikora",
      pullHostname: "cdn.test",
      tokenKey: "fake-token-key",
      fetch: zone,
      clock,
    });
    const store = documentStoreOver(objects, DESCRIPTOR, MAX_SIGNED_URL_SECONDS);
    await store.get("o1/d1/original.pdf");
    expect(seen).toEqual(["GET /krizaka-assets/verikora/o1/d1/original.pdf"]);
    const link = (await store.signedUrl("o1/d1/original.pdf", 60))!;
    const expires = Math.floor(NOW.getTime() / 1000) + 60;
    // the token of before the swap: sha256(tokenKey + path + expires), url-safe base64
    const token = crypto
      .createHash("sha256")
      .update(`fake-token-key/verikora/o1/d1/original.pdf${expires}`)
      .digest("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(link).toBe(`https://cdn.test/verikora/o1/d1/original.pdf?token=${token}&expires=${expires}`);
    expect(link).not.toContain("fake-token-key");
    expect(link).not.toContain("fake-zone-credential");
  });

  it("keeps the refusal of a provider that says no: a StorageError 502", async () => {
    const store = documents(
      s3(async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "",
      })),
    );
    await expect(store.put(KEY, new Uint8Array([1]), { contentType: "application/pdf" })).rejects.toMatchObject({
      status: 502,
      name: "StorageError",
    });
  });
});

describe("data paths are personal data", () => {
  it("encrypted at rest: the provider holds ciphertext, the plain text comes back through the store, and no link points at ciphertext", async () => {
    const bucket = fakeBucket();
    const store = documents(encrypted()(s3(bucket.fetchLike), crypto.randomBytes(32)));
    const text = new TextEncoder().encode("Loyer mensuel : 1 450 $ — Sophie Gagnon");
    await store.put(KEY, text, { contentType: "text/plain" });
    const held = [...bucket.objects.values()][0]!;
    expect(Buffer.from(held.bytes).includes(Buffer.from("Sophie"))).toBe(false);
    expect(held.contentType).toBe("application/octet-stream");
    expect(Buffer.from((await store.get(KEY))!.bytes).toString()).toContain("Sophie Gagnon");
    expect(await store.signedUrl(KEY, 60)).toBeNull();
  });

  it("signed links are short-lived: never longer than 15 minutes, whatever is asked", async () => {
    const lived = async (ttl: number) =>
      Number(
        new URL((await documents(s3(fakeBucket().fetchLike)).signedUrl(KEY, ttl))!).searchParams.get("X-Amz-Expires"),
      );
    expect(await lived(60)).toBe(60);
    expect(await lived(86400)).toBe(900);
  });

  it("retention purge: deleting a kept document removes its object at its key, and a second purge is harmless", async () => {
    const bucket = fakeBucket();
    const store = documents(s3(bucket.fetchLike));
    await store.put(KEY, new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    expect(bucket.objects.size).toBe(1);
    await store.delete(KEY);
    expect(bucket.objects.size).toBe(0);
    expect(await store.get(KEY)).toBeNull();
    await expect(store.delete(KEY)).resolves.toBeUndefined();
    expect(
      bucket.calls
        .filter((c) => c.method === "DELETE")
        .every((c) => c.url.endsWith(`/verikora-documents/verikora/${KEY}`)),
    ).toBe(true);
  });
});
