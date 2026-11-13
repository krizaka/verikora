import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as consentRoute } from "@/app/api/consents/route";
import { POST as createKeyRoute } from "@/app/api/me/api-keys/route";
import { POST as createOrganizeTagRoute } from "@/app/api/organize/[kind]/tags/route";
import { POST as createViewRoute } from "@/app/api/organize/[kind]/views/route";

import { requestApplicantFile } from "../applicant-file";
import { migrate, pool, query } from "../db";
import { LEASE_REPORT } from "../fixtures/lease-report";
import { seedDatabase } from "../flows";
import { resetRateLimits } from "../limits";
import { TAG_COLORS } from "../organisation/rules";
import {
  createCollection,
  createFolder,
  createLibrary,
  createTag,
  defaultCollectionId,
  ensureLibrary,
  ownedCollection,
} from "../organisation/store";
import { createGrant } from "../report-access";
import { createSession, SESSION_COOKIE } from "../session";
import { seedWorkspace } from "../workspace/service";
import { CASES, type IsolationCase, LISTS, type OwnIds, type RouteKey, type TheirIds } from "./cases";

/**
 * Customer isolation on PostgreSQL (krizaka-internal#2383; CI's service, locally `DATABASE_IT=1 DATABASE_URL=… pnpm test`). Two
 * customers, A and B, each signed in and with an API key. B tries every route of `cases.ts` with A's ids and must get exactly what B
 * gets for an id no row has (a 404, the same code): B learns neither A's row nor that it exists. A reading their own row succeeds, and
 * after every attempt A's rows are as they were. B's lists never hold one of A's ids.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");
const NOW = new Date("2026-11-13T12:00:00Z");

interface Customer {
  id: string;
  email: string;
  session: string;
  apiKey: string;
}
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const [METHOD, ROUTE] = [(key: RouteKey) => key.split(" ")[0]!, (key: RouteKey) => key.split(" ")[1]!];

async function handlerOf(key: RouteKey): Promise<Handler> {
  const mod = (await import(path.join(APP, ROUTE(key), "route.ts"))) as Record<string, Handler>;
  const handler = mod[METHOD(key)];
  if (!handler) throw new Error(`${key}: no such handler`);
  return handler;
}

/** One call to a route handler, as a customer, with the path's values filled in. */
async function call(key: RouteKey, who: Customer, auth: IsolationCase["auth"], ask: ReturnType<IsolationCase["ask"]>) {
  resetRateLimits();
  const concrete = ROUTE(key).replace(/\[(\w+)\]/g, (_, name: string) => ask.params[name] ?? `missing-${name}`);
  const headers: Record<string, string> =
    auth === "session" ? { cookie: `${SESSION_COOKIE}=${who.session}` } : { authorization: `Bearer ${who.apiKey}` };
  let body: BodyInit | undefined;
  if (ask.form) body = ask.form();
  else if (ask.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(ask.body);
  }
  const res = await (
    await handlerOf(key)
  )(new Request(`http://localhost${concrete}${ask.search ?? ""}`, { method: METHOD(key), headers, body }), {
    params: Promise.resolve(ask.params),
  });
  const text = await res.text();
  return { status: res.status, code: codeOf(text), text };
}

/** The `code` of a JSON error body; a file or an empty body has none. */
function codeOf(text: string): unknown {
  try {
    return (JSON.parse(text) as { code?: unknown }).code ?? null;
  } catch {
    return null;
  }
}

/** Ids of the same shape that no row has: what B gets for them is what B must get for A's. */
const absent = (their: TheirIds): TheirIds =>
  Object.fromEntries(
    Object.entries(their).map(([k, v]) => [
      k,
      v.startsWith("ctr_") ? `ctr_${crypto.randomBytes(12).toString("hex")}` : crypto.randomUUID(),
    ]),
  ) as unknown as TheirIds;

describe.runIf(enabled)("customer isolation: B never reaches A's rows (krizaka-internal#2383)", () => {
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  let a: Customer;
  let b: Customer;
  let their: TheirIds;
  let own: OwnIds;

  const customer = async (who: string): Promise<Customer> => {
    const email = `${who}-${stamp}@verikora.test`;
    const [row] = await query<{ id: string }>(
      `INSERT INTO accounts (email, password_hash, plan, subscription_status, current_period_end, terms_accepted_at, email_verified_at)
       VALUES ($1, 'x', 'PRO', 'active', now() + interval '30 days', now(), now()) RETURNING id`,
      [email],
    );
    const session = (await createSession(row!.id, { ip: "203.0.113.83", userAgent: "vitest" })).token;
    const minted = await createKeyRoute(
      new Request("http://localhost/api/me/api-keys", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${session}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "ERP", scopes: ["reports:read", "contracts:seal"], expiresInDays: 30 }),
      }),
    );
    expect(minted.status).toBe(201);
    // the landlord's undertaking the screening flow asks for, given through its route
    const consent = await consentRoute(
      new Request("http://localhost/api/consents", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${session}`, "content-type": "application/json" },
        body: JSON.stringify({ key: "screening-landlord-undertaking" }),
      }),
    );
    expect(consent.status).toBe(201);
    return { id: row!.id, email, session, apiKey: ((await minted.json()) as { key: string }).key };
  };
  const document = async (owner: string, name: string) => {
    const text = `Bail fictif isolation ${name}`;
    const [row] = await query<{ id: string }>(
      `INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text)
       VALUES ($1, $2, $3, 'text/plain', $4, $5, convert_to($6, 'UTF8'), $6) RETURNING id`,
      [owner, `Bail ${name}`, `bail-${name}.txt`, text.length, crypto.randomBytes(32).toString("hex"), text],
    );
    return row!.id;
  };
  const organizeTag = async (who: Customer, name: string) => {
    const res = await createOrganizeTagRoute(
      new Request("http://localhost/api/organize/applicant_file/tags", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${who.session}`, "content-type": "application/json" },
        body: JSON.stringify({ name: `${name} ${stamp}`, marker: "amber" }),
      }),
      { params: Promise.resolve({ kind: "applicant_file" }) },
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { tag: { id: string } }).tag.id;
  };
  const batch = async (owner: string, documentId: string, analysisId: string, lines: number) => {
    const [row] = await query<{ id: string }>(
      "INSERT INTO batches (owner_id, name, finished_at) VALUES ($1, $2, now()) RETURNING id",
      [owner, `Lot ${stamp}`],
    );
    for (let line = 2; line < 2 + lines; line++)
      await query(
        "INSERT INTO batch_items (batch_id, line, file_name, reference, document_id, analysis_id, state) VALUES ($1, $2, 'bail.txt', 'R-1', $3, $4, 'done')",
        [row!.id, line, documentId, analysisId],
      );
    return row!.id;
  };

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    await seedWorkspace({ now: () => NOW });
    [a, b] = [await customer("client-a"), await customer("client-b")];

    const documentA = await document(a.id, "a");
    const [analysis] = await query<{ id: string }>(
      "INSERT INTO analyses (document_id, studio, status, run_id, report, finished_at) VALUES ($1, 'compliance-check', 'succeeded', $2, $3, now()) RETURNING id",
      [documentA, `run-isolation-${stamp}`, LEASE_REPORT],
    );
    const { grantId: grant } = await createGrant(
      { id: a.id, email: a.email },
      documentA,
      analysis!.id,
      { email: `tiers-${stamp}@verikora.test`, expiresAt: null },
      NOW,
    );
    await query(
      "INSERT INTO deletion_receipts (id, owner_id, document_id, rule, body, sha256, issued_at) VALUES (gen_random_uuid(), $1, $2, 'after-check', '{}', $3, now())",
      [a.id, documentA, crypto.randomBytes(32).toString("hex")],
    );
    const application = await requestApplicantFile(
      { id: a.id, email: a.email },
      { candidateName: "Camille Fictif", candidateEmail: `candidat-${stamp}@exemple.test`, types: ["pay-stub"] },
      NOW,
    );
    const contract = `ctr_${crypto.randomBytes(12).toString("hex")}`;
    await query(
      "INSERT INTO sealed_contracts (id, owner_id, partner_id, document_type, sha256, zone, key_id, sealed_at, content) VALUES ($1, $2, 'partner', 'lease', $3, 'CA', 'k', now(), '\\x255044462d')",
      [contract, a.id, crypto.randomBytes(32).toString("hex")],
    );
    const library = await createLibrary(query, a.id, `Bibliothèque A ${stamp}`);
    const collection = await createCollection(query, a.id, library.id, `Collection A ${stamp}`);
    const folder = await createFolder(query, a.id, collection.id, `Dossier A ${stamp}`);
    const tag = await createTag(query, a.id, `Étiquette A ${stamp}`, TAG_COLORS[0]);
    const [webhook] = await query<{ id: string }>(
      "INSERT INTO webhook_endpoints (id, owner_id, url, secret_sealed, events, created_at) VALUES (gen_random_uuid(), $1, 'https://hooks.exemple.test/a', 'sealed', ARRAY['check.finished'], now()) RETURNING id",
      [a.id],
    );
    const [apiKey] = await query<{ id: string }>("SELECT id FROM api_keys WHERE owner_id = $1", [a.id]);
    const view = await createViewRoute(
      new Request("http://localhost/api/organize/applicant_file/views", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${a.session}`, "content-type": "application/json" },
        body: JSON.stringify({ name: `Vue A ${stamp}`, filters: {} }),
      }),
      { params: Promise.resolve({ kind: "applicant_file" }) },
    );
    expect(view.status).toBe(201);
    their = {
      document: documentA,
      analysis: analysis!.id,
      grant,
      application: application.id,
      batch: await batch(a.id, documentA, analysis!.id, 2),
      check: await batch(a.id, documentA, analysis!.id, 1),
      contract,
      library: library.id,
      homeLibrary: (await ownedCollection(query, a.id, await defaultCollectionId(query, a.id))).library_id,
      collection: collection.id,
      folder: folder.id,
      tag: tag.id,
      organizeTag: await organizeTag(a, "Garant A"),
      view: ((await view.json()) as { view: { id: string } }).view.id,
      apiKey: apiKey!.id,
      webhook: webhook!.id,
    };
    // two libraries: B deleting a library is then refused for its owner check, not because it would be B's last
    const libraryB = await ensureLibrary(query, b.id, `Bibliothèque B ${stamp}`);
    await createLibrary(query, b.id, `Bibliothèque B2 ${stamp}`);
    own = {
      document: await document(b.id, "b"),
      collection: (await createCollection(query, b.id, libraryB.id, `Collection B ${stamp}`)).id,
      organizeTag: await organizeTag(b, "Garant B"),
    };
  });
  afterAll(async () => {
    await query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[a?.id, b?.id].filter(Boolean)]);
    await pool().end();
  });

  const cases = Object.entries(CASES).flatMap(([key, variants]) =>
    variants.map((c, i) => ({ key: key as RouteKey, c, name: variants.length > 1 ? `${key} (#${i + 1})` : key })),
  );

  it.each(cases)("$name: B with A's id gets what B gets for an id no row has", async ({ key, c }) => {
    const theirs = await call(key, b, c.auth, c.ask(their, own));
    const none = await call(key, b, c.auth, c.ask(absent(their), own));
    expect({ status: theirs.status, code: theirs.code }).toEqual({ status: none.status, code: none.code });
    expect(theirs.status, theirs.text.slice(0, 300)).toBe(c.status ?? 404);
    if (c.ownerRead) {
      const mine = await call(key, a, c.auth, c.ask(their, own));
      expect(mine.status, `${key} as its owner: ${mine.text.slice(0, 300)}`).toBeLessThan(400);
    }
  });

  it.each(Object.entries(LISTS).map(([key, l]) => ({ key: key as RouteKey, l })))(
    "$key: B's list holds none of A's ids",
    async ({ key, l }) => {
      const ask = { params: l.params ?? {}, search: l.search };
      const seen = await call(key, b, l.auth, ask);
      expect(seen.status, seen.text.slice(0, 300)).toBeLessThan(400);
      const leaked = Object.entries({ ...their, email: a.email })
        .filter(([, v]) => seen.text.includes(v))
        .map(([k]) => k);
      expect(leaked).toEqual([]);
      if (l.shows) expect((await call(key, a, l.auth, ask)).text).toContain(their[l.shows]);
    },
  );

  it("after every attempt, A's rows are as they were, and none of B's rows landed in A's", async () => {
    const one = async (sql: string, values: unknown[]) => (await query<{ n: number }>(sql, values))[0]!.n;
    expect(
      await one("SELECT count(*)::int AS n FROM documents WHERE id = $1 AND owner_id = $2", [their.document, a.id]),
    ).toBe(1);
    expect(await one("SELECT count(*)::int AS n FROM analyses WHERE id = $1", [their.analysis])).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM report_grants WHERE analysis_id = $1 AND revoked_at IS NULL", [
        their.analysis,
      ]),
    ).toBe(1);
    expect(
      await one(
        "SELECT count(*)::int AS n FROM screenings WHERE id = $1 AND revoked_at IS NULL AND closed_at IS NULL",
        [their.application],
      ),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM api_keys WHERE id = $1 AND revoked_at IS NULL", [their.apiKey]),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM webhook_endpoints WHERE id = $1 AND active", [their.webhook]),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM libraries WHERE id = $1 AND name LIKE 'Bibliothèque A%'", [
        their.library,
      ]),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM collections WHERE id = $1 AND name LIKE 'Collection A%'", [
        their.collection,
      ]),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM folders WHERE id = $1 AND name LIKE 'Dossier A%'", [their.folder]),
    ).toBe(1);
    expect(await one("SELECT count(*)::int AS n FROM folders WHERE collection_id = $1", [their.collection])).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM documents WHERE collection_id = $1 AND owner_id <> $2", [
        their.collection,
        a.id,
      ]),
    ).toBe(0);
    expect(
      await one("SELECT count(*)::int AS n FROM organize.tag WHERE id = $1 AND name LIKE 'Garant A%'", [
        their.organizeTag,
      ]),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM organize.view WHERE id = $1 AND name LIKE 'Vue A%'", [their.view]),
    ).toBe(1);
    expect(
      await one("SELECT count(*)::int AS n FROM organize.applicant_file_tag WHERE tag_id = $1", [own.organizeTag]),
    ).toBe(0);
    for (const { key, c } of cases.filter((x) => x.c.ownerRead))
      expect((await call(key, a, c.auth, c.ask(their, own))).status, key).toBeLessThan(400);
  });
});
