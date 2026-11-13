import type { SovkoraRun } from "@verikora/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as webExport } from "@/app/api/batches/[id]/export/route";
import { POST as createKeyRoute } from "@/app/api/me/api-keys/route";
import { GET as apiExport } from "@/app/api/v1/batches/[id]/export/route";

import { migrate, pool, query } from "../db";
import { LEASE_REPORT as REPORT, leasePdf } from "../fixtures/lease-report";
import { seedDatabase } from "../flows";
import { resetRateLimits } from "../limits";
import { cleanPdf } from "../preflight/fixtures";
import { zipEntries, zipEntryBytes } from "../preflight/inspector";
import { verifyPdf } from "../report-pdf";
import { signingKey } from "../report-signer";
import { createSession, SESSION_COOKIE } from "../session";
import { settingsFor } from "../settings/guards";
import { useSovkoraClient } from "../sovkora";
import { advanceBatch, createBatch } from "./run";

/** A batch's reports in one archive, by the page's route and by the API with a key (verikora#242), against PostgreSQL and a fake Sovkora. CI's service; locally DATABASE_IT=1 DATABASE_URL=…. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.runIf(enabled)("the ZIP of a batch's reports", () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const runs = new Map<string, { studio: string; status: string }>();
  let n = 0;
  let owner = { id: "", perspective: null };
  let ownerToken = "";
  let strangerToken = "";
  let bearer = "";
  let batchId = "";

  const run = (id: string): SovkoraRun => {
    const r = runs.get(id)!;
    const outputs =
      r.status !== "SUCCEEDED"
        ? []
        : r.studio === "compliance-check"
          ? [{ key: "report", type: "JSON", value: REPORT }]
          : [
              {
                key: "signals",
                type: "JSON",
                value: JSON.stringify({
                  header: "h",
                  signals: [{ signalId: "PDF-META-001", level: "observé", observation: "Produit par un logiciel." }],
                }),
              },
            ];
    return { id, studioKey: r.studio, blueprintVersion: "1.0.0", status: r.status, outputs };
  };
  const get = (credential: { cookie?: string; key?: string }, path: string) =>
    new Request(`http://localhost${path}`, {
      headers: credential.cookie
        ? { cookie: `${SESSION_COOKIE}=${credential.cookie}` }
        : credential.key
          ? { authorization: `Bearer ${credential.key}` }
          : {},
    });

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    useSovkoraClient({
      startRun: async (studio: string) => {
        const id = `run-zip-${stamp}-${++n}`;
        runs.set(id, { studio, status: "RUNNING" });
        return run(id);
      },
      getRun: async (id: string) => run(id),
    } as never);
    const make = async (label: string, pro: boolean) => {
      const [row] = await query<{ id: string }>(
        pro
          ? "INSERT INTO accounts (email, plan, subscription_status, current_period_end) VALUES ($1, 'PRO', 'active', now() + interval '30 days') RETURNING id"
          : "INSERT INTO accounts (email) VALUES ($1) RETURNING id",
        [`zip-${label}-${stamp}@verikora.test`],
      );
      return { id: row!.id, token: (await createSession(row!.id, { ip: "203.0.113.30", userAgent: "vitest" })).token };
    };
    const a = await make("owner", true);
    owner = { id: a.id, perspective: null };
    ownerToken = a.token;
    strangerToken = (await make("stranger", false)).token;
    const key = await createKeyRoute(
      new Request("http://localhost/api/me/api-keys", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "ERP", scopes: ["reports:read"], expiresInDays: 30 }),
      }),
    );
    bearer = (await key.json()).key;

    const ctx = async () => ({ settings: await settingsFor(owner.id), now: new Date(), environment: "dev" as const });
    const created = await createBatch(
      owner,
      "Immeuble Laurier",
      "file,check,reference\nbail-zip.pdf,compliance,LAURIER-ÉTIENNE\ntalon-zip.pdf,authenticity,PAIE-A\nmanquant-zip.pdf,compliance,LAURIER-X",
      [
        { name: "bail-zip.pdf", type: "application/pdf", bytes: await leasePdf(`ZIP ${stamp}`) },
        { name: "talon-zip.pdf", type: "application/pdf", bytes: await cleanPdf(`TALON ZIP ${stamp}`) },
      ],
      {
        ...(await ctx()),
        settings: { ...(await settingsFor(owner.id)), "limits.batchConcurrency": { value: 5 } } as never,
      },
    );
    runs.forEach((r) => (r.status = "SUCCEEDED"));
    batchId = (await advanceBatch(owner, created.id, await ctx())).id;
  });
  afterAll(async () => {
    useSovkoraClient(null);
    await query("DELETE FROM accounts WHERE email LIKE $1", [`zip-%-${stamp}@verikora.test`]);
    await pool().end();
  });

  it("the page's route gives the CSV, the signed PDF that verifies, the signals, the README — a refused row listed with its reason", async () => {
    resetRateLimits();
    const res = await webExport(
      get({ cookie: ownerToken }, `/api/batches/${batchId}/export?format=zip&lang=fr`),
      params(batchId),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-disposition")).toContain(`lot-${batchId.slice(0, 8)}-rapports.zip`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(zipEntries(bytes)!.map((e) => e.name)).toEqual([
      "lot.csv",
      "LISEZ-MOI.txt",
      "rapports/2-LAURIER-ETIENNE-fr.pdf",
      "signaux/3-PAIE-A.json",
    ]);

    const pdf = zipEntryBytes(bytes, "rapports/2-LAURIER-ETIENNE-fr.pdf", 1 << 22)!;
    const verified = await verifyPdf(new Uint8Array(pdf), signingKey());
    expect(verified.ok).toBe(true);
    expect(
      JSON.parse(zipEntryBytes(bytes, "signaux/3-PAIE-A.json", 1 << 20)!.toString()).report.signals[0].signalId,
    ).toBe("PDF-META-001");
    const csv = zipEntryBytes(bytes, "lot.csv", 1 << 20)!.toString();
    expect(csv).toContain("2,bail-zip.pdf,LAURIER-ÉTIENNE,done,,rapports/2-LAURIER-ETIENNE-fr.pdf");
    expect(csv).toContain("4,manquant-zip.pdf,LAURIER-X,refused,FILE_NOT_SENT,");
    expect(zipEntryBytes(bytes, "LISEZ-MOI.txt", 1 << 20)!.toString()).toContain("avis juridique");
    // the plain CSV export is still what it was
    const plain = await webExport(get({ cookie: ownerToken }, `/api/batches/${batchId}/export`), params(batchId));
    expect(plain.headers.get("content-type")).toContain("text/csv");
  });

  it("the API gives the same archive with a key (reports:read), in the language asked, and audits it under the key", async () => {
    resetRateLimits();
    const res = await apiExport(get({ key: bearer }, `/api/v1/batches/${batchId}/export?lang=en`), params(batchId));
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(zipEntries(bytes)!.map((e) => e.name)).toContain("rapports/2-LAURIER-ETIENNE-en.pdf");
    expect(zipEntryBytes(bytes, "LISEZ-MOI.txt", 1 << 20)!.toString()).toContain("not legal advice");
    const [audit] = await query<{ actor_label: string }>(
      "SELECT actor_label FROM audit_log WHERE actor_id = $1 AND action = 'api.batch.exported'",
      [owner.id],
    );
    expect(audit!.actor_label).toMatch(/^api-key:/);
  });

  it("the API answers in French when lang is omitted — as the OpenAPI document says — and in English when asked", async () => {
    resetRateLimits();
    const bytes = new Uint8Array(
      await (await apiExport(get({ key: bearer }, `/api/v1/batches/${batchId}/export`), params(batchId))).arrayBuffer(),
    );
    expect(zipEntries(bytes)!.map((e) => e.name)).toContain("rapports/2-LAURIER-ETIENNE-fr.pdf");
    expect(zipEntryBytes(bytes, "LISEZ-MOI.txt", 1 << 20)!.toString()).toContain("avis juridique");
  });

  it("without a key 401; another account's batch 404; a malformed id 404", async () => {
    resetRateLimits();
    expect((await apiExport(get({}, `/api/v1/batches/${batchId}/export`), params(batchId))).status).toBe(401);
    expect(
      (await webExport(get({ cookie: strangerToken }, `/api/batches/${batchId}/export?format=zip`), params(batchId)))
        .status,
    ).toBe(404);
    expect((await apiExport(get({ key: bearer }, "/api/v1/batches/nope/export"), params("nope"))).status).toBe(404);
  });
});
