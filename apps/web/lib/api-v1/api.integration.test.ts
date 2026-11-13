import type { SovkoraRun } from "@verikora/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as createKeyRoute } from "@/app/api/me/api-keys/route";
import { GET as batchRoute } from "@/app/api/v1/batches/[id]/route";
import { POST as createBatchRoute } from "@/app/api/v1/batches/route";
import { GET as checkRoute } from "@/app/api/v1/checks/[id]/route";
import { POST as createCheckRoute } from "@/app/api/v1/checks/route";

import { migrate, pool, query } from "../db";
import { LEASE_REPORT as REPORT, leasePdf } from "../fixtures/lease-report";
import { seedDatabase } from "../flows";
import { resetRateLimits } from "../limits";
import { cleanPdf } from "../preflight/fixtures";
import { createSession, SESSION_COOKIE } from "../session";
import { useSovkoraClient } from "../sovkora";

/**
 * The public API v1 through its real route handlers, a Pro account's API key, PostgreSQL and the audit trail (CI's service; locally
 * DATABASE_IT=1 DATABASE_URL=…). Sovkora is a fake that records the runs and finishes them when told.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** The secret part of `yzk_<public id>_<secret>`: the secret is base64url, so it may itself contain « _ » — never split on it. */
const secretOf = (key: string) => key.slice(key.indexOf("_", key.indexOf("_") + 1) + 1);

describe.runIf(enabled)("the public API v1 (verikora#202)", () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const runs = new Map<string, string>();
  let n = 0;
  const run = (id: string, status: string): SovkoraRun => ({
    id,
    studioKey: "compliance-check",
    blueprintVersion: "1.0.0",
    status,
    outputs: status === "SUCCEEDED" ? [{ key: "report", type: "JSON", value: REPORT }] : [],
  });
  let owner = "";
  let stranger = "";
  let bearer = "";
  let readOnly = "";
  let strangerBearer = "";

  /** A Pro account, signed in, that mints keys through the real route. */
  const proAccount = async (email: string) => {
    const [row] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, plan, subscription_status, current_period_end, terms_accepted_at) VALUES ($1, 'x', 'PRO', 'active', now() + interval '30 days', now()) RETURNING id",
      [email],
    );
    const token = (await createSession(row!.id, { ip: "203.0.113.9", userAgent: "vitest" })).token;
    const mint = async (name: string, scopes: string[]) => {
      const res = await createKeyRoute(
        new Request("http://localhost/api/me/api-keys", {
          method: "POST",
          headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
          body: JSON.stringify({ name, scopes, expiresInDays: 30 }),
        }),
      );
      expect(res.status).toBe(201);
      return (await res.json()).key as string;
    };
    return { id: row!.id, mint };
  };
  const call = (credential: string | null, method: string, path: string, body?: FormData) =>
    new Request(`http://localhost${path}`, {
      method,
      headers: credential ? { authorization: `Bearer ${credential}` } : {},
      body,
    });
  const checkForm = async (name: string, text: string, check = "compliance", reference = "R-1") => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await leasePdf(text))], name, { type: "application/pdf" }));
    form.set("check", check);
    form.set("reference", reference);
    return form;
  };

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    useSovkoraClient({
      startRun: async () => {
        const id = `run-api-${stamp}-${++n}`;
        runs.set(id, "RUNNING");
        return run(id, "RUNNING");
      },
      getRun: async (id: string) => run(id, runs.get(id) ?? "RUNNING"),
    } as never);
    const a = await proAccount(`api-v1-${stamp}@verikora.test`);
    owner = a.id;
    bearer = await a.mint("ERP", ["checks:write", "reports:read"]);
    readOnly = await a.mint("Lecture", ["reports:read"]);
    const b = await proAccount(`api-v1-other-${stamp}@verikora.test`);
    stranger = b.id;
    strangerBearer = await b.mint("ERP", ["checks:write", "reports:read"]);
  });
  afterAll(async () => {
    useSovkoraClient(null);
    await query("DELETE FROM accounts WHERE id = ANY($1)", [[owner, stranger]]);
    await pool().end();
  });

  it("starts a check, reads it back while it runs, then with its report once Sovkora has finished", async () => {
    resetRateLimits();
    const created = await createCheckRoute(
      call(bearer, "POST", "/api/v1/checks", await checkForm("bail.pdf", "BAIL RESIDENTIEL")),
    );
    expect(created.status).toBe(201);
    const { check } = await created.json();
    expect(check).toMatchObject({ state: "running", file: "bail.pdf", reference: "R-1", error: null, report: null });
    expect(check.documentId).toBeTruthy();

    const running = await (
      await checkRoute(call(bearer, "GET", `/api/v1/checks/${check.id}`), params(check.id))
    ).json();
    expect(running.check).toMatchObject({ id: check.id, state: "running", report: null });

    runs.set([...runs.keys()].at(-1)!, "SUCCEEDED");
    const done = await (await checkRoute(call(bearer, "GET", `/api/v1/checks/${check.id}`), params(check.id))).json();
    expect(done.check.state).toBe("done");
    expect(done.check.finishedAt).not.toBeNull();
    expect(done.check.report).toMatchObject({ findings: expect.any(Array) });
  });

  it("refuses without a key, with a key lacking the scope, and a malformed request, all with stable codes", async () => {
    resetRateLimits();
    const none = await createCheckRoute(call(null, "POST", "/api/v1/checks", await checkForm("a.pdf", "A")));
    expect([none.status, (await none.json()).code]).toEqual([401, "API_KEY_MISSING"]);
    const narrow = await createCheckRoute(call(readOnly, "POST", "/api/v1/checks", await checkForm("a.pdf", "A")));
    expect([narrow.status, (await narrow.json()).code]).toEqual([403, "API_KEY_SCOPE"]);
    const noCheck = new FormData();
    noCheck.set("file", new File([new Uint8Array(await cleanPdf("A"))], "a.pdf", { type: "application/pdf" }));
    const bad = await createCheckRoute(call(bearer, "POST", "/api/v1/checks", noCheck));
    expect([bad.status, (await bad.json()).code]).toEqual([400, "BAD_REQUEST"]);
    const unknown = await (
      await createCheckRoute(call(bearer, "POST", "/api/v1/checks", await checkForm("b.pdf", "B", "magic")))
    ).json();
    expect(unknown.check).toMatchObject({ state: "refused", error: "UNKNOWN_CHECK" });
  });

  it("a check or a batch belongs to its owner: another account's key sees a 404, a malformed id too", async () => {
    resetRateLimits();
    const { check } = await (
      await createCheckRoute(call(bearer, "POST", "/api/v1/checks", await checkForm("c.pdf", "C", "compliance", "R-C")))
    ).json();
    expect((await checkRoute(call(strangerBearer, "GET", `/api/v1/checks/${check.id}`), params(check.id))).status).toBe(
      404,
    );
    expect(
      (await batchRoute(call(strangerBearer, "GET", `/api/v1/batches/${check.id}`), params(check.id))).status,
    ).toBe(404);
    expect((await checkRoute(call(bearer, "GET", "/api/v1/checks/not-an-id"), params("not-an-id"))).status).toBe(404);
  });

  it("runs a batch from a CSV: per-row states, the refused row with its reason", async () => {
    resetRateLimits();
    const form = new FormData();
    form.set(
      "manifest",
      new File(
        [["file,check,reference", "d.pdf,compliance,R-D", "e.pdf,authenticity,R-E"].join("\n")],
        "Immeuble.csv",
        { type: "text/csv" },
      ),
    );
    form.append("files", new File([new Uint8Array(await leasePdf("D"))], "d.pdf", { type: "application/pdf" }));
    const created = await createBatchRoute(call(bearer, "POST", "/api/v1/batches", form));
    expect(created.status).toBe(201);
    const { batch } = await created.json();
    expect(batch.name).toBe("Immeuble");
    expect(batch.items.map((i: { state: string }) => i.state)).toEqual(["running", "refused"]);
    expect(batch.items[1].error).toBe("FILE_NOT_SENT");
    const read = await (await batchRoute(call(bearer, "GET", `/api/v1/batches/${batch.id}`), params(batch.id))).json();
    expect(read.batch.id).toBe(batch.id);
    expect(read.batch.counts).toMatchObject({ running: 1, refused: 1 });
  });

  it("records every call in the audit trail under the key's id, never the key itself", async () => {
    const rows = await query<{ action: string; actor_label: string; detail: unknown }>(
      "SELECT action, actor_label, detail FROM audit_log WHERE actor_id = $1 AND action LIKE 'api.%'",
      [owner],
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const action of ["api.check.created", "api.check.read", "api.batch.created", "api.batch.read"])
      expect(actions, action).toContain(action);
    expect(rows.every((r) => /^api-key:[0-9a-f-]{36}$/.test(r.actor_label))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(secretOf(bearer));
  });
});
