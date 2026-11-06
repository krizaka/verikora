import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

/**
 * The gate (verikora#243): without a session the signed-in space redirects to sign-in and the API answers 401. Proved on every
 * route of `app/api` — a new route is guarded or it is named in PUBLIC with the reason, and the test says which.
 */
const API = fileURLToPath(new URL("../app/api", import.meta.url));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const ID = "5c0e3f3e-0000-4000-8000-000000000001";

/** The routes that answer without a session, and why. Everything else must answer 401 (or 403 for the API-key and administration locks). */
const PUBLIC: Record<string, string> = {
  "auth/confirm-email": "the link mailed to the person (a single-use token)",
  "auth/forgot-password": "asks for a reset link by e-mail: the same answer for every address, limited (verikora#288)",
  "auth/reset-password":
    "sets the new password from the mailed link (single use, time-limited), limited (verikora#288)",
  "auth/sign-in": "it opens the session",
  "auth/sign-out": "it ends the session; harmless without one",
  "auth/sign-up": "it creates the account (closed by its own switch)",
  "auth/sign-up/status": "whether sign-up is open: one boolean for the bar",
  "auth/verify-email": "the link mailed to the person (a single-use token)",
  healthz: "the platform's health probe",
  me: "who is signed in: signed out is a 200 `{ signedIn: false }`, the family's contract (krizaka-ui#551); lib/me-route.test.ts holds it",
  "screenings/respond": "the applicant's own link (a token), not a member",
  applicant:
    "the applicant's own link (a token), not a member: the notice, consent per purpose, erasure (verikora#131)",
  "applicant/documents":
    "the applicant's own link (a token, open and consented): one document of the file, checked and purged (verikora#127)",
  showcase: "the home's recorded sample, nothing personal",
  "showcase/file": "the home's recorded sample, nothing personal",
  "webhooks/payments": "signed by the payment vendor, refused without its signature",
  "webhooks/mail": "signed by the mail vendor (bounces, complaints), refused without its signature (verikora#48)",
  "batches/template": "the CSV template: a static file",
  "v1/openapi.json": "the public contract of the API",
  "rapport/[token]/pdf":
    "the signed PDF of the owner report (verikora#481): the token of a live owner link is the credential, 404 otherwise, each download logged",
  "verify/contract/[id]":
    "the public check of a sealed contract by its SHA-256 (verikora#71): who sealed it and when, no name, no account, no content",
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

describe("the API answers 401 without a session (verikora#243)", () => {
  const files = walk(API).filter((f) => f.endsWith(`${sep}route.ts`));
  it("finds the routes", () => expect(files.length).toBeGreaterThan(40));

  for (const file of files) {
    const route = relative(API, file).split(sep).slice(0, -1).join("/");
    const pattern = route.replace(/\[\w+\]/g, "[id]");
    if (PUBLIC[route] || PUBLIC[pattern]) continue;
    it(`/api/${route}`, async () => {
      const routeModule = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      const handlers = METHODS.filter((m) => typeof routeModule[m] === "function");
      expect(handlers.length, "a route exports a method").toBeGreaterThan(0);
      for (const method of handlers) {
        const req = new Request(`http://localhost/api/${route}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        });
        const res = await (
          routeModule[method] as (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>
        )(req, { params: Promise.resolve({ id: ID, tab: "infos", token: ID }) });
        // 401 for a session, API-key or operator lock; an administration route may answer its own lock first, but never 2xx.
        expect([401, 403], `${method} /api/${route} → ${res.status}`).toContain(res.status);
      }
    });
  }
});

describe("the signed-in space redirects to sign-in without a session (verikora#243)", () => {
  it("the layout of /{locale}/app/** sends a signed-out visitor to /{locale}/sign-in, in each language", async () => {
    vi.resetModules();
    vi.doMock("@/lib/access", () => ({ pageSession: async () => null }));
    const { default: Layout } = await import("../app/[locale]/(app)/app/layout");
    for (const locale of ["en", "fr"]) {
      const error = await Layout({ children: null, params: Promise.resolve({ locale }) }).then(
        () => null,
        (e: unknown) => e as { digest?: string },
      );
      expect(error?.digest, locale).toMatch(new RegExp(`^NEXT_REDIRECT;replace;/${locale}/sign-in;`));
    }
    vi.doUnmock("@/lib/access");
  });
});
