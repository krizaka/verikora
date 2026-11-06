import crypto from "node:crypto";

import { encryptedStore, type FetchLike, remoteStore } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { documentStoreOver } from "./adapter";
import { documentStoreContract } from "./contract.testkit";
import { MAX_SIGNED_URL_SECONDS } from "./providers";
import { asDescriptor } from "./where";

/**
 * The HTTP (Bunny-shaped) store against the REAL storage zone, with fictional data only, under `verikora/it/` (opt-in: set
 * STORAGE_IT_BUNNY_ZONE, STORAGE_IT_BUNNY_ACCESS and optionally STORAGE_IT_BUNNY_ENDPOINT; every object is deleted after the test).
 */
const e = process.env;
const enabled = !!e.STORAGE_IT_BUNNY_ZONE && !!e.STORAGE_IT_BUNNY_ACCESS;
const DESCRIPTOR = asDescriptor({
  kind: "bunny",
  endpoint: null,
  region: null,
  residency: "elsewhere",
  encrypted: false,
  owner: "krizaka",
  devOnly: true,
});
const objects = () =>
  remoteStore({
    endpoint: e.STORAGE_IT_BUNNY_ENDPOINT ?? "storage.bunnycdn.com",
    zone: e.STORAGE_IT_BUNNY_ZONE!,
    accessKey: e.STORAGE_IT_BUNNY_ACCESS!,
    prefix: "verikora/it",
    fetch: fetch as unknown as FetchLike,
    clock: { now: () => new Date() },
  });
const make = () => documentStoreOver(objects(), DESCRIPTOR, MAX_SIGNED_URL_SECONDS);

describe.runIf(enabled)("http store (real zone, fictional data)", () => {
  documentStoreContract("bunny live", make);
  documentStoreContract("bunny live + encryption", () =>
    documentStoreOver(encryptedStore(objects(), crypto.randomBytes(32)), DESCRIPTOR, MAX_SIGNED_URL_SECONDS),
  );

  it("what it holds is not publicly readable through the pull zone without the zone's authentication", async () => {
    const store = make();
    await store.put("it/public-check/doc.txt", new TextEncoder().encode("fictional"), { contentType: "text/plain" });
    const anonymous = await fetch(
      `https://${e.STORAGE_IT_BUNNY_ENDPOINT ?? "storage.bunnycdn.com"}/${e.STORAGE_IT_BUNNY_ZONE}/verikora/it/it/public-check/doc.txt`,
    );
    expect(anonymous.status).toBe(401);
    await store.delete("it/public-check/doc.txt");
  });
});
