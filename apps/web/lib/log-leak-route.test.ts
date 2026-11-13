import { createHmac } from "node:crypto";

import { memorySuppression } from "@krizaka/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureLogs, type LogCapture } from "./fixtures/capture-logs";

/**
 * Logs (krizaka-internal#2385): the server log, captured during the upload → check → share path, holds no e-mail address, no
 * session or API token, no key and no document text. The real `lib/log.ts`, `handle()` and the mail package's logger run;
 * the happy path carries the secrets through the routes, and every step is also made to fail with an error that quotes them
 * (what a database driver or a mail provider does), because a failure is where a log line gets written.
 */
const EMAIL = "eric.locataire@example.test";
const OWNER_EMAIL = "proprietaire.secret@example.test";
const SESSION = "ys1.SESSIONTOKENabc123_-xyz";
const API_CREDENTIAL = `oz_${"k".repeat(24)}`;
const BEARER = `Bearer ${API_CREDENTIAL}`;
const VENDOR_HMAC = `hmac-${"z".repeat(20)}`;
const DOCUMENT_TEXT = "CLAUSE-CANARY-4417 le locataire verse 1 234,56 $ par mois";
const SECRETS = [EMAIL, OWNER_EMAIL, SESSION, API_CREDENTIAL, VENDOR_HMAC, "HUNTER2pass", "CLAUSE-CANARY-4417"];

const state = vi.hoisted(() => ({
  fail: false,
  suppression: null as null | ReturnType<typeof import("@krizaka/email").memorySuppression>,
}));
const failure = () =>
  Object.assign(
    new Error(`write failed for ${"eric.locataire@example.test"} with ${"Bearer oz_ABCDEF0123456789abcdef"}`),
    {
      code: "ECONNRESET",
      cause: new Error(
        `connect ${"postgres://verikora:HUNTER2pass@db.example.test:25060/verikora_db"} token=ys1.SESSIONTOKENabc123_-xyz`,
      ),
      input: "CLAUSE-CANARY-4417",
    },
  );

vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./access", () => ({
  requireSession: async () => ({
    id: "ys1.SESSIONTOKENabc123_-xyz",
    account: { id: "11111111-1111-4111-8111-111111111111", email: "eric.locataire@example.test", role: "USER" },
  }),
}));
vi.mock("./limits", () => ({ limit: async () => undefined }));
vi.mock("./audit", () => ({ audit: async () => undefined }));
vi.mock("./db", () => ({ query: async () => [], transaction: async () => undefined }));
vi.mock("./settings/guards", () => ({
  assertFeature: async () => undefined,
  assertOpen: async () => undefined,
  settingsFor: async () => ({ "limits.purgeAfterHours": { value: 24 } }),
}));
vi.mock("./settings/boundary", async () => ({
  preflightRulesFrom: () => (async () => (await import("./preflight/rules")).VERIKORA_RULES)(),
}));
vi.mock("./settings/instance", () => ({ appSettings: () => ({ get: async () => undefined }) }));
vi.mock("@/app/active-store", () => ({
  storesOf: async () => ({ settings: { mode: "managed" }, write: {} }),
  workingStore: async () => ({}),
  storeForDocument: async () => ({}),
}));
vi.mock("./documents", () => ({
  listDocuments: async () => [],
  storeDocument: async () => {
    if (state.fail) {
      throw failure();
    }
    return {
      summary: { id: "d1", sizeBytes: 10, mimeType: "text/plain" },
      duplicate: false,
    };
  },
}));
vi.mock("./organisation/store", () => ({ placeDocument: async () => undefined }));
vi.mock("./preflight-events", () => ({ recordPreflight: async () => undefined }));
vi.mock("./owner-report-shares", () => ({
  createShare: async () => {
    if (state.fail) {
      throw failure();
    }
    return { id: "s1", token: "sc1.token", expiresAt: "2026-12-01T00:00:00.000Z" };
  },
  emailShare: async () => {
    if (state.fail) {
      throw failure();
    }
    return { sentTo: "p***@example.test" };
  },
}));
vi.mock("./mailer", () => ({ mailerFor: () => ({}) }));
vi.mock("@/lib/mail/store", () => ({
  pgSuppression: {
    has: (e: string) => state.suppression!.has(e),
    add: (e: string, r: "bounce" | "complaint" | "unsubscribed") => state.suppression!.add(e, r),
  },
}));

import { POST as createShare } from "../app/api/applications/[id]/report-shares/route";
import { POST as sendShare } from "../app/api/applications/[id]/report-shares/send/route";
import { POST as upload } from "../app/api/documents/route";
import { POST as mailWebhook } from "../app/api/webhooks/mail/route";

const FILE = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id: FILE }) };
const headers = { authorization: BEARER, cookie: `session=${SESSION}`, "x-forwarded-for": "203.0.113.9" };

const uploadText = () => {
  const form = new FormData();
  form.append("file", new File([DOCUMENT_TEXT], "bail.txt", { type: "text/plain" }));
  return upload(new Request("https://dev.verikora.test/api/documents", { method: "POST", headers, body: form }));
};
const share = () =>
  createShare(
    new Request("https://dev.verikora.test/api/applications/x/report-shares", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ days: 30 }),
    }),
    ctx,
  );
const sendLink = () =>
  sendShare(
    new Request("https://dev.verikora.test/api/applications/x/report-shares/send", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ token: "sc1.token", email: OWNER_EMAIL, locale: "fr" }),
    }),
    ctx,
  );
const bounce = () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = "random-token-123";
  const signature = createHmac("sha256", VENDOR_HMAC)
    .update(timestamp + token)
    .digest("hex");
  return mailWebhook(
    new Request("http://localhost/api/webhooks/mail", {
      method: "POST",
      body: JSON.stringify({
        signature: { timestamp, token, signature },
        "event-data": { event: "failed", severity: "permanent", recipient: EMAIL },
      }),
    }),
  );
};

let logs: LogCapture;
beforeEach(() => {
  state.fail = false;
  state.suppression = memorySuppression();
  vi.stubEnv("MAIL_WEBHOOK_VENDOR_HMAC", VENDOR_HMAC);
  logs = captureLogs();
});
afterEach(() => logs.stop());

const expectClean = (text: string) => {
  for (const secret of SECRETS) {
    expect(text, `the log holds ${secret}`).not.toContain(secret);
  }
  expect(text).not.toMatch(/Bearer\s+(?!\[redacted\])\S/i);
  expect(text).not.toMatch(/\bys1\.[\w-]+/);
  expect(text).not.toMatch(/postgres(?:ql)?:\/\//i);
};

describe("the server log of the upload → check → share path", () => {
  it("the log capture really sees what the server writes (a canary line)", () => {
    console.log("canary-line");
    expect(logs.text()).toContain("canary-line");
  });

  it("holds no secret when every step succeeds", async () => {
    expect((await uploadText()).status).toBe(201);
    expect((await share()).status).toBe(201);
    expect((await sendLink()).status).toBe(202);
    expect((await bounce()).status).toBe(200);
    expectClean(logs.text());
  });

  it("holds no secret when every step fails with an error that quotes them", async () => {
    state.fail = true;
    for (const step of [uploadText, share, sendLink]) {
      const res = await step();
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toMatch(/example\.test|HUNTER2|ys1\.|CANARY/);
    }
    const text = logs.text();
    expect(text).toContain("api: unexpected error"); // the failures were logged…
    expectClean(text); // …and said none of it.
  });
});
