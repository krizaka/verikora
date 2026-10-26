import { readFileSync } from "node:fs";

import type { OrazakaRun } from "@yomizaka/core";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { seedDatabase } from "../flows";
import { refuse } from "../http";
import { useOrazakaClient } from "../orazaka";
import { createCollection, createLibrary } from "../organisation/store";
import { cleanPdf } from "../preflight/fixtures";
import { settingsFor } from "../settings/guards";
import { advanceBatch, createBatch } from "./run";

/**
 * What the B2B demo found (docs/demo-b2b.md), against the real database and a fake Orazaka: a busy engine pauses the batch and it
 * resumes by itself (#248); one file that cannot be stored is that row's refusal, a photo is a document (#249); one lease listed
 * for two checks survives the first (#250); a row's collection is where its document goes (#251). CI's service; locally
 * YOMIZAKA_DB_IT=1 DATABASE_URL=….
 */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const REPORT = readFileSync(new URL("../fixtures/orazaka-compliance-qc-1.2.0.json", import.meta.url), "utf8");

describe.runIf(enabled)("a batch against a busy engine and awkward files", () => {
  const state = { busy: false, n: 0, started: [] as string[] };
  const runs = new Map<string, { studio: string; status: string }>();
  let account = { id: "", perspective: null };
  const ctx = async () => ({ settings: await settingsFor(account.id), now: new Date(), environment: "dev" as const });
  const pdf = async (name: string, text: string) => ({ name, type: "application/pdf", bytes: await cleanPdf(text) });
  const finishAll = () => runs.forEach((r) => (r.status = "SUCCEEDED"));

  const run = (id: string): OrazakaRun => {
    const r = runs.get(id)!;
    const outputs = r.status !== "SUCCEEDED" ? [] : r.studio === "compliance-check" ? [{ key: "report", type: "JSON", value: REPORT }] : [{ key: "signals", type: "JSON", value: JSON.stringify({ header: "h", signals: [] }) }];
    return { id, studioKey: r.studio, blueprintVersion: "1.0.0", status: r.status, outputs };
  };

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    useOrazakaClient({
      startRun: async (studio: string) => {
        if (state.busy) throw refuse(429, "ORAZAKA_BUSY", "Orazaka is busy", { retryAfter: 15 });
        const id = `run-fault-${++state.n}`;
        state.started.push(id);
        runs.set(id, { studio, status: "RUNNING" });
        return run(id);
      },
      getRun: async (id: string) => run(id),
    } as never);
    const [row] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`batch-faults-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@yomizaka.test`]);
    account = { id: row!.id, perspective: null };
  });
  afterAll(() => useOrazakaClient(null));

  it("a busy engine pauses the batch with its reason — no row fails — and the rows start by themselves once there is room", async () => {
    state.busy = true;
    const created = await createBatch(account, "Occupé", "file,check\nbusy-a.pdf,compliance\nbusy-b.pdf,compliance", [await pdf("busy-a.pdf", "BAIL BUSY A"), await pdf("busy-b.pdf", "BAIL BUSY B")], await ctx());
    expect(created.pausedBy).toBe("ORAZAKA_BUSY");
    expect(created.items.map((i) => i.state)).toEqual(["pending", "pending"]);
    expect(created.counts.failed).toBe(0);
    expect(created.finishedAt).toBeNull();

    state.busy = false;
    const resumed = await advanceBatch(account, created.id, await ctx());
    expect(resumed.pausedBy).toBeNull();
    expect(resumed.items.map((i) => i.state)).toEqual(["running", "running"]);
    finishAll();
    expect((await advanceBatch(account, created.id, await ctx())).finishedAt).not.toBeNull();
  });

  it("a photo in a row goes through the quality gate (a blank one is refused as blurred, nothing stored); a file that cannot be stored refuses its row only", async () => {
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#f4f0e6" } }).jpeg().toBuffer();
    const created = await createBatch(
      account,
      "Photos",
      "file,check\nlease-photo.jpg,compliance\nnotes.exe,compliance\nlease-ok.pdf,compliance",
      [{ name: "lease-photo.jpg", type: "image/jpeg", bytes: new Uint8Array(jpeg) }, { name: "notes.exe", type: "application/octet-stream", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) }, await pdf("lease-ok.pdf", "BAIL PHOTOS OK")],
      await ctx(),
    );
    // A flat photo has no edges: the gate of yomizaka#8 refuses its row before anything is stored or read.
    expect(created.items.map((i) => i.state)).toEqual(["refused", "refused", "running"]);
    expect(created.items[0]).toMatchObject({ error: "PHOTO_BLURRY" });
    expect(created.items[0]!.documentId).toBeNull();
    expect(created.items[1]!.error).toBeTruthy();
    expect(created.items[1]!.documentId).toBeNull();
    finishAll();
    expect((await advanceBatch(account, created.id, await ctx())).finishedAt).not.toBeNull();
  });

  it("one lease listed for compliance and for authenticity is not purged by the first check", async () => {
    const created = await createBatch(account, "Deux vérifications", "file,check\nboth.pdf,compliance\nboth.pdf,authenticity", [await pdf("both.pdf", "BAIL DEUX VERIFICATIONS")], { ...(await ctx()), settings: { ...(await settingsFor(account.id)), "limits.batchConcurrency": { value: 1 } } as never });
    expect(created.items.map((i) => i.state)).toEqual(["running", "pending"]);
    finishAll();
    const next = await advanceBatch(account, created.id, { ...(await ctx()), settings: { ...(await settingsFor(account.id)), "limits.batchConcurrency": { value: 1 } } as never });
    expect(next.items.map((i) => [i.state, i.error])).toEqual([
      ["done", null],
      ["running", null],
    ]);
    finishAll();
    const done = await advanceBatch(account, created.id, await ctx());
    expect(done.items.map((i) => i.state)).toEqual(["done", "done"]);
    // and once nothing needs it any more, the not-kept document is purged
    const [doc] = await query<{ text: string }>("SELECT text FROM documents WHERE id = $1", [done.items[0]!.documentId]);
    expect(doc!.text).toBe("");
  });

  it("two advances at once (the tick and a reader) start a row once and fail nothing (#266)", async () => {
    state.busy = true;
    const created = await createBatch(account, "Concurrence", "file,check\nrace-a.pdf,compliance", [await pdf("race-a.pdf", "BAIL RACE A")], await ctx());
    expect(created.items[0]!.state).toBe("pending");
    state.busy = false;
    const before = state.started.length;
    // the batch route accepts an upper-case id: it is the same batch and the same lock
    const both = await Promise.all([advanceBatch(account, created.id, await ctx()), advanceBatch(account, created.id.toUpperCase(), await ctx()), advanceBatch(account, created.id, await ctx())]);
    expect(state.started.length - before).toBe(1);
    for (const view of both) expect(view.counts.failed).toBe(0);
    const [row] = await query<{ state: string }>("SELECT state FROM batch_items WHERE batch_id = $1", [created.id]);
    expect(row!.state).toBe("running");
    finishAll();
    expect((await advanceBatch(account, created.id, await ctx())).finishedAt).not.toBeNull();
  });

  it("a check already running on the document waits for it — and when Orazaka has finished it meanwhile the row moves on (#266)", async () => {
    state.busy = true;
    const created = await createBatch(account, "Déjà en cours", "file,check\nrunning-a.pdf,compliance\nrunning-b.pdf,compliance", [await pdf("running-a.pdf", "BAIL DEJA EN COURS A"), await pdf("running-b.pdf", "BAIL DEJA EN COURS B")], await ctx());
    state.busy = false;
    runs.set("run-elsewhere-live", { studio: "compliance-check", status: "RUNNING" });
    runs.set("run-elsewhere-done", { studio: "compliance-check", status: "SUCCEEDED" });
    await query("INSERT INTO analyses (document_id, studio, status, run_id) VALUES ($1, 'compliance-check', 'running', 'run-elsewhere-live')", [created.items[0]!.documentId]);
    await query("INSERT INTO analyses (document_id, studio, status, run_id) VALUES ($1, 'compliance-check', 'running', 'run-elsewhere-done')", [created.items[1]!.documentId]);
    const advanced = await advanceBatch(account, created.id, await ctx());
    expect(advanced.counts.failed).toBe(0);
    // still running at Orazaka: the row waits
    expect(advanced.items[0]!.state).toBe("pending");
    // finished at Orazaka while nobody looked: refreshed, then the normal rules (here a new run) — never stuck behind it
    expect(advanced.items[1]!.state).not.toBe("pending");
  });

  it("many batches advanced at once never starve the connection pool (#266)", async () => {
    state.busy = true;
    const batches = await Promise.all(Array.from({ length: 12 }, async (_, n) => createBatch(account, `Pool ${n}`, `file,check\npool-${n}.pdf,compliance`, [await pdf(`pool-${n}.pdf`, `BAIL POOL ${n} ${Date.now()}`)], await ctx())));
    state.busy = false;
    const views = await Promise.all(batches.map(async (b) => advanceBatch(account, b.id, await ctx())));
    expect(views).toHaveLength(12);
    expect(views.every((v) => v.counts.failed === 0)).toBe(true);
  }, 30_000);

  it("a row naming one of the owner's collections files its document there; an unknown name leaves it where it is", async () => {
    const library = await createLibrary(query, account.id, "Gestion Laurier");
    const building = await createCollection(query, account.id, library.id, "Immeuble Laurier");
    const created = await createBatch(
      account,
      "Immeuble",
      "file,check,collection\nin-building.pdf,compliance,immeuble LAURIER\nelsewhere.pdf,compliance,Inconnu",
      [await pdf("in-building.pdf", "BAIL IMMEUBLE"), await pdf("elsewhere.pdf", "BAIL AILLEURS")],
      await ctx(),
    );
    const placed = await query<{ id: string; collection_id: string }>("SELECT id, collection_id FROM documents WHERE id = ANY($1)", [created.items.map((i) => i.documentId)]);
    const of = (row: number) => placed.find((d) => d.id === created.items[row]!.documentId)!.collection_id;
    expect(of(0)).toBe(building.id);
    expect(of(1)).not.toBe(building.id);
  });
});
