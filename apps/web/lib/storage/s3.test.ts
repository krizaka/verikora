import crypto from "node:crypto";

import { bucketStore, encryptedStore, type FetchLike } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { documentStoreOver } from "./adapter";
import { documentStoreContract } from "./contract.testkit";
import { MAX_SIGNED_URL_SECONDS } from "./providers";
import { asDescriptor } from "./where";

/**
 * The S3 store (`@krizaka/storage`'s bucketStore) against a real S3-compatible server — a local S3 server (scripts/ci-s3.sh), never a paid
 * service. Set STORAGE_IT_S3_ENDPOINT (`http://localhost:9000`), STORAGE_IT_S3_USER, STORAGE_IT_S3_PASS and STORAGE_IT_S3_BUCKET to run it.
 */
const e = process.env;
const enabled =
  !!e.STORAGE_IT_S3_ENDPOINT && !!e.STORAGE_IT_S3_USER && !!e.STORAGE_IT_S3_PASS && !!e.STORAGE_IT_S3_BUCKET;
const DESCRIPTOR = asDescriptor({
  kind: "s3",
  endpoint: null,
  region: "us-east-1",
  residency: "elsewhere",
  encrypted: false,
  owner: "krizaka",
  devOnly: false,
});
const objects = (pass = e.STORAGE_IT_S3_PASS!) =>
  bucketStore({
    endpoint: e.STORAGE_IT_S3_ENDPOINT!,
    region: "us-east-1",
    bucket: e.STORAGE_IT_S3_BUCKET!,
    accessKeyId: e.STORAGE_IT_S3_USER!,
    secretAccessKey: pass,
    prefix: "verikora-it",
    fetch: fetch as unknown as FetchLike,
    clock: { now: () => new Date() },
  });
const make = (pass?: string) => documentStoreOver(objects(pass), DESCRIPTOR, MAX_SIGNED_URL_SECONDS);

/** In CI the job sets STORAGE_IT_S3_REQUIRED: a missing variable is a failure, not a silent skip (krizaka/verikora#198). */
describe.runIf(!!e.STORAGE_IT_S3_REQUIRED)("s3 adapter (S3 server) is required here", () => {
  it("has its S3 variables", () => expect(enabled).toBe(true));
});

describe.runIf(enabled)("s3 adapter (S3 server)", () => {
  documentStoreContract("s3", () => make());
  documentStoreContract("s3 + encryption", () =>
    documentStoreOver(encryptedStore(objects(), crypto.randomBytes(32)), DESCRIPTOR, MAX_SIGNED_URL_SECONDS),
  );

  it("hands out a presigned link the browser can follow", async () => {
    const store = make();
    await store.put("it/presigned/doc.txt", new TextEncoder().encode("bonjour"), { contentType: "text/plain" });
    const link = (await store.signedUrl("it/presigned/doc.txt", 60))!;
    const res = await fetch(link);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bonjour");
    await store.delete("it/presigned/doc.txt");
  });

  it("refuses a wrong credential", async () => {
    await expect(
      make("wrong").put("it/x/doc.txt", new Uint8Array([1]), { contentType: "text/plain" }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
