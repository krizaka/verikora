import http from "node:http";
import type { AddressInfo } from "node:net";

import { createProviderService, memoryProviderStore } from "@krizaka/storage/provider-admin";
import { afterEach, describe, expect, it } from "vitest";

import { ownBucketStore, registerOwnS3 } from "@/lib/storage/own-providers";

import { openContextOf } from "./storage-providers";
import { systemClock } from "./system-clock";

/**
 * A person's own bucket is called by our server with the context the product opens every provider with (`openContextOf`): a bucket that
 * passed its connection test and then answers a redirect is refused, and the address it points at is never called
 * (krizaka-restricted#344).
 */

const KEY = new Uint8Array(32).fill(7);
const DOC_KEY = "owner-1/doc-1/original.pdf";
const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
});

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A tiny S3 on path-style URLs (PUT, GET, HEAD, DELETE), that can be turned into one that answers every request with a redirect. */
async function bucketServer(redirectTo: string) {
  const files = new Map<string, Buffer>();
  const state = { redirect: false };
  const origin = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://bucket").pathname;
      if (state.redirect) {
        res.writeHead(302, { location: `${redirectTo}${req.url}` }).end();
      } else if (req.method === "PUT") {
        files.set(path, Buffer.concat(chunks));
        res.writeHead(200).end();
      } else if (req.method === "DELETE") {
        files.delete(path);
        res.writeHead(200).end();
      } else {
        const found = files.get(path);
        res.writeHead(found ? 200 : 404, { "content-type": "application/pdf" }).end(found);
      }
    });
  });
  return { origin, state };
}

describe("a person's own bucket that answers a redirect", () => {
  it("is refused on a read, and the address it points at is never called", async () => {
    const reached: string[] = [];
    const inside = await listen((req, res) => {
      reached.push(`${req.method} ${req.url}`);
      req.resume();
      res.writeHead(200, { "content-type": "application/pdf" }).end("inside");
    });
    const bucket = await bucketServer(inside);
    let n = 0;
    const service = createProviderService({
      store: memoryProviderStore(),
      vault: { keyId: "k1", key: KEY, ring: { keys: { k1: KEY } } },
      clock: systemClock,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      open: openContextOf(),
      probeId: () => "probe",
      references: async () => 0,
      audit: async () => undefined,
    });
    const where = { endpoint: bucket.origin, region: "ca-central-1" };
    const id = await registerOwnS3({ service }, { id: "u1", label: "Camille" }, "owner-1", {
      ...where,
      bucket: "mine",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    const store = await ownBucketStore({ service }, id, where);
    await store.put(DOC_KEY, new TextEncoder().encode("%PDF-1.7"), { contentType: "application/pdf" });
    expect(new TextDecoder().decode((await store.get(DOC_KEY))?.bytes)).toBe("%PDF-1.7");

    bucket.state.redirect = true;
    await expect(store.get(DOC_KEY)).rejects.toThrow(/Storage refused the request/);
    await expect(store.delete(DOC_KEY)).rejects.toThrow(/Storage refused the request/);
    expect(reached).toEqual([]);
  });
});
