import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { cloudConnector } from "@krizaka/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginConnection, CLOUD, type CloudFlow, type CloudName, completeConnection, offeredClouds, registrationOf, revokeGrant, sealState } from "./cloud-connect";
import { disconnectedStore } from "./own-providers";

/** A fake OAuth server: the authorization code is exchanged only with the verifier whose S256 challenge the authorize step saw (PKCE), and the revocation is recorded. */
let server: Server;
let base = "";
const challenges = new Map<string, string>();
const revoked: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      res.setHeader("content-type", "application/json");
      if (req.url === "/token") {
        const wanted = challenges.get(body.get("code") ?? "");
        const got = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
        if (!wanted || wanted !== got) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        res.end(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "bearer" }));
        return;
      }
      if (req.url === "/revoke") revoked.push(body.get("token") ?? "");
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const KEY = randomBytes(32);
const NOW = new Date("2026-10-29T12:00:00Z");
const PUBLIC = "https://www.example.test";
const env = { MEDIA_CLOUD_GOOGLE_CLIENT_ID: "google-client", MEDIA_CLOUD_GOOGLE_CLIENT_SECRET: "google-secret", MEDIA_CLOUD_DROPBOX_CLIENT_ID: "dropbox-client" };

const flow = (now: Date = NOW): CloudFlow => ({
  connector: (name: CloudName) => cloudConnector(CLOUD[name], { authorize: `${base}/authorize`, token: `${base}/token`, revoke: { style: "rfc7009", url: `${base}/revoke` } }),
  registration: (name) => registrationOf(name, env, PUBLIC),
  vaultKey: KEY,
  now: () => now,
  nonce: () => "n-1",
});

/** The person's browser: opens the authorize URL (the fake provider remembers the challenge) and comes back with a code and the state. */
function consent(url: string): { code: string; state: string } {
  const u = new URL(url);
  const code = `code-${randomBytes(4).toString("hex")}`;
  challenges.set(code, u.searchParams.get("code_challenge")!);
  return { code, state: u.searchParams.get("state")! };
}

describe("the clouds a person may connect (yomizaka#530)", () => {
  it("offers a cloud only when the deployment holds its registration", () => {
    expect(offeredClouds(env, PUBLIC)).toEqual(["dropbox", "google"]);
    expect(offeredClouds({}, PUBLIC)).toEqual([]);
  });

  it("starts with PKCE S256, the redirect address and a state that carries the verifier sealed", () => {
    const { url } = beginConnection(flow(), "owner-1", "google");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${base}/authorize`);
    expect(u.searchParams.get("client_id")).toBe("google-client");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(`${PUBLIC}/api/me/storage/cloud/callback`);
    expect(u.searchParams.get("scope")).toContain("drive.file");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).not.toContain("owner-1");
  });

  it("refuses a cloud the deployment has no registration for", () => {
    expect(() => beginConnection(flow(), "owner-1", "microsoft")).toThrow(/not available/);
  });

  it("finishes the connection: the code is exchanged with the verifier and the refresh token comes back", async () => {
    const back = consent(beginConnection(flow(), "owner-1", "google").url);
    const connected = await completeConnection(flow(), "owner-1", back);
    expect(connected).toEqual({ cloud: "google", refreshToken: "refresh-1", clientId: "google-client", clientSecret: "google-secret" });
  });

  it("refuses a state started by someone else, changed, or expired", async () => {
    const back = consent(beginConnection(flow(), "owner-1", "google").url);
    await expect(completeConnection(flow(), "owner-2", back)).rejects.toMatchObject({ body: { code: "CLOUD_STATE_INVALID" } });
    await expect(completeConnection(flow(), "owner-1", { code: back.code, state: `${back.state}x` })).rejects.toMatchObject({ body: { code: "CLOUD_STATE_INVALID" } });
    const later = new Date(NOW.getTime() + 11 * 60_000);
    await expect(completeConnection(flow(later), "owner-1", back)).rejects.toMatchObject({ body: { code: "CLOUD_STATE_EXPIRED" } });
  });

  it("does not exchange a code whose verifier is not the one of the start (PKCE)", async () => {
    const back = consent(beginConnection(flow(), "owner-1", "google").url);
    const forged = sealState(KEY, { owner: "owner-1", cloud: "google", verifier: "not-the-verifier", nonce: "n" }, NOW);
    await expect(completeConnection(flow(), "owner-1", { code: back.code, state: forged })).rejects.toThrow();
  });

  it("revokes the grant at the cloud, and a cloud that cannot be reached never keeps the person connected", async () => {
    expect(await revokeGrant(flow(), "google", "refresh-1")).toBe(true);
    expect(revoked).toContain("refresh-1");
    const broken: CloudFlow = { ...flow(), connector: () => cloudConnector("google-drive", { revoke: { style: "rfc7009", url: "http://127.0.0.1:1/revoke" } }) };
    expect(await revokeGrant(broken, "google", "refresh-1")).toBe(false);
  });
});

describe("a cloud the person disconnected", () => {
  it("says STORAGE_DISCONNECTED to a read, writes nothing, and lets an erasure through", async () => {
    const store = disconnectedStore("google-drive");
    await expect(store.get("a/b.pdf")).rejects.toMatchObject({ body: { code: "STORAGE_DISCONNECTED" }, status: 409 });
    await expect(store.put("a/b.pdf", new Uint8Array([1]), { contentType: "application/pdf" })).rejects.toMatchObject({ body: { code: "STORAGE_DISCONNECTED" } });
    await expect(store.delete("a/b.pdf")).resolves.toBeUndefined();
    expect(store.describe()).toMatchObject({ kind: "cloud", owner: "workspace" });
  });
});
