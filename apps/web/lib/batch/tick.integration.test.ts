import { readFileSync } from "node:fs";

import type { OrazakaRun } from "@yomizaka/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedAudits } from "../audit-credits.testkit";
import { migrate, pool, query } from "../db";
import { withAdvisoryLock } from "../db";
import { seedDatabase } from "../flows";
import { refuse } from "../http";
import { useOrazakaClient } from "../orazaka";
import { cleanPdf } from "../preflight/fixtures";
import { settingsFor } from "../settings/guards";
import { appSettings, resetAppSettings } from "../settings/instance";
import { GLOBAL } from "../settings/service";
import { createBatch } from "./run";
import { dueBatches, TICK_LOCK, tickBatches } from "./tick";

/** A batch that advances without anyone opening it (yomizaka#240), against PostgreSQL and a fake Orazaka (CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const REPORT = readFileSync(new URL("../fixtures/orazaka-compliance-qc-1.2.0.json", import.meta.url), "utf8");

describe.runIf(enabled)("the batch tick", () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const state = { busy: false, n: 0, status: "RUNNING" };
  const runs = new Map<string, string>();
  const actor = { id: null, label: "test" };
  let owner = { id: "", perspective: null };
  let other = { id: "", perspective: null };
  const pdf = async (name: string, text: string) => ({ name, type: "application/pdf", bytes: await cleanPdf(text) });
  const run = (id: string): OrazakaRun => ({ id, studioKey: "compliance-check", blueprintVersion: "1.0.0", status: runs.get(id) ?? "RUNNING", outputs: runs.get(id) === "SUCCEEDED" ? [{ key: "report", type: "JSON", value: REPORT }] : [] });
  const open = async (who: typeof owner, name: string, file: string) => createBatch(who, name, `file,check\n${file},compliance`, [await pdf(file, `BAIL ${name} ${stamp}`)], { settings: await settingsFor(who.id), now: new Date(), environment: "dev" });

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    useOrazakaClient({
      startRun: async () => {
        if (state.busy) throw refuse(429, "ORAZAKA_BUSY", "busy", { retryAfter: 15 });
        const id = `run-tick-${stamp}-${++state.n}`;
        runs.set(id, "RUNNING");
        return run(id);
      },
      getRun: async (id: string) => run(id),
    } as never);
    // Other tests leave unfinished batches in the same database: this one must not depend on being among the first ten.
    await appSettings().set(actor, GLOBAL, "limits.batchTickBatches", 100, new Date());
    resetAppSettings();
    const make = async (label: string) => (await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`tick-${label}-${stamp}@yomizaka.test`]))[0]!.id;
    owner = { id: await make("a"), perspective: null };
    other = { id: await make("b"), perspective: null };
  });
  afterAll(async () => {
    useOrazakaClient(null);
    for (const key of ["limits.batchTickBatches", "limits.batchTickMaxAgeHours"] as const) await appSettings().reset(actor, GLOBAL, key, new Date());
    resetAppSettings();
    await query("DELETE FROM accounts WHERE id = ANY($1)", [[owner.id, other.id]]);
    await pool().end();
  });

  it("finishes a batch nobody opens: the first look reads the runs back, the batch closes", async () => {
    const created = await open(owner, "personne", "tick-a.pdf");
    expect(created.items[0]!.state).toBe("running");
    runs.forEach((_, id) => runs.set(id, "SUCCEEDED"));
    const report = await tickBatches(new Date(), "dev", undefined, [owner.id, other.id]);
    expect(report).toMatchObject({ ran: true, failed: 0 });
    expect(report.advanced).toBeGreaterThanOrEqual(1);
    const [row] = await query<{ finished_at: Date | null }>("SELECT finished_at FROM batches WHERE id = $1", [created.id]);
    expect(row!.finished_at).not.toBeNull();
    const [item] = await query<{ state: string }>("SELECT state FROM batch_items WHERE batch_id = $1", [created.id]);
    expect(item!.state).toBe("done");
  });

  it("a busy engine: the rows wait, then start by themselves at a later look — no row fails", async () => {
    state.busy = true;
    const created = await open(owner, "occupé", "tick-b.pdf");
    expect(created.pausedBy).toBe("ORAZAKA_BUSY");
    state.busy = false;
    await tickBatches(new Date(), "dev", undefined, [owner.id, other.id]);
    expect((await query<{ state: string }>("SELECT state FROM batch_items WHERE batch_id = $1", [created.id]))[0]!.state).toBe("running");
    runs.forEach((_, id) => runs.set(id, "SUCCEEDED"));
    await tickBatches(new Date(), "dev", undefined, [owner.id, other.id]);
    expect((await query<{ finished_at: Date | null }>("SELECT finished_at FROM batches WHERE id = $1", [created.id]))[0]!.finished_at).not.toBeNull();
  });

  it("a batch waiting for the account to pay is left alone for a while, not hammered at every look", async () => {
    await query("UPDATE accounts SET terms_accepted_at = now() WHERE id = $1", [other.id]);
    await seedAudits(other.id, { freeUsed: true });
    const created = await open(other, "sans crédit", "tick-c.pdf");
    expect(created.pausedBy).toBe("PAYWALL");
    await tickBatches(new Date(), "dev", undefined, [owner.id, other.id]);
    const [row] = await query<{ tick_after: Date | null }>("SELECT tick_after FROM batches WHERE id = $1", [created.id]);
    expect(row!.tick_after!.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    const due = await dueBatches(new Date(), 48, 100, [owner.id, other.id]);
    expect(due.map((b) => b.id)).not.toContain(created.id);
    // ten minutes later it is looked at again
    expect((await dueBatches(new Date(Date.now() + 11 * 60_000), 48, 100, [owner.id, other.id])).map((b) => b.id)).toContain(created.id);
  });

  it("takes the oldest batches first, only the young ones, and no more than the setting says", async () => {
    await query("UPDATE batches SET finished_at = now() WHERE finished_at IS NULL AND owner_id = ANY($1)", [[owner.id, other.id]]);
    state.busy = true;
    const first = await open(owner, "premier", "tick-d1.pdf");
    const second = await open(owner, "second", "tick-d2.pdf");
    const third = await open(owner, "troisième", "tick-d3.pdf");
    state.busy = false;
    await query("UPDATE batches SET tick_after = NULL WHERE id = ANY($1)", [[first.id, second.id, third.id]]);
    await query("UPDATE batches SET created_at = now() - interval '72 hours' WHERE id = $1", [first.id]);
    const mineOnly = (ids: string[]) => ids.filter((id) => [first.id, second.id, third.id].includes(id));
    expect(mineOnly((await dueBatches(new Date(), 48, 1000)).map((b) => b.id))).toEqual([second.id, third.id]);
    expect(mineOnly((await dueBatches(new Date(), 96, 1000)).map((b) => b.id))).toEqual([first.id, second.id, third.id]);
    expect((await dueBatches(new Date(), 48, 2)).length).toBeLessThanOrEqual(2);
  });

  it("another instance holding the lock means this one does nothing", async () => {
    const held = withAdvisoryLock(TICK_LOCK, async () => {
      expect(await tickBatches(new Date(), "dev", undefined, [owner.id, other.id])).toEqual({ advanced: 0, failed: 0, ran: false });
      return "ok";
    });
    expect(await held).toBe("ok");
  });
});
