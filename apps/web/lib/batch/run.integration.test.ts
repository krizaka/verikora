import { readFileSync } from "node:fs";

import type { OrazakaRun } from "@yomizaka/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedAudits } from "../audit-credits.testkit";
import { migrate, query } from "../db";
import { seedDatabase } from "../flows";
import { useOrazakaClient } from "../orazaka";
import { cleanPdf } from "../preflight/fixtures";
import { settingsFor } from "../settings/guards";
import { advanceBatch, createBatch } from "./run";

/** A batch's life against the real database, check path and billing (CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…). Orazaka is a fake that records the runs. */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("a batch of checks (yomizaka#232)", () => {
  const runs = new Map<string, string>();
  let n = 0;
  // A real compliance report (a live run's, kept as a fixture): a « SUCCEEDED » without one is a hollow success, read as failed.
  const REPORT = readFileSync(new URL("../fixtures/orazaka-compliance-qc-1.2.0.json", import.meta.url), "utf8");
  const run = (id: string, status: string): OrazakaRun => ({ id, studioKey: "compliance-check", blueprintVersion: "1.0.0", status, outputs: status === "SUCCEEDED" ? [{ key: "report", type: "JSON", value: REPORT }] : [] });
  let account = { id: "", perspective: null };
  const pdf = async (name: string, text: string) => ({ name, type: "application/pdf", bytes: await cleanPdf(text) });

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    useOrazakaClient({
      startRun: async () => {
        const id = `run-batch-${++n}`;
        runs.set(id, "RUNNING");
        return run(id, "RUNNING");
      },
      getRun: async (id: string) => run(id, runs.get(id) ?? "RUNNING"),
    } as never);
    const [row] = await query<{ id: string }>("INSERT INTO accounts (email, audit_credits) VALUES ($1, 2) RETURNING id", [`batch-run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@yomizaka.test`]);
    account = { id: row!.id, perspective: null };
  });
  afterAll(() => useOrazakaClient(null));

  it("records the refused rows, stores the others and starts them up to the concurrency; a failed row never stops the rest", async () => {
    const settings = { ...(await settingsFor(account.id)), "limits.batchConcurrency": { value: 1 } } as Awaited<ReturnType<typeof settingsFor>>;
    const manifest = ["file,check,reference", "a.pdf,compliance,R-1", "b.pdf,compliance,R-2", "c.pdf,audit,R-3"].join("\n");
    const created = await createBatch(account, "Immeuble Laurier", manifest, [await pdf("a.pdf", "BAIL A"), await pdf("b.pdf", "BAIL B")], { settings, now: new Date(), environment: "dev" });
    expect(created.items.map((i) => [i.line, i.state])).toEqual([
      [2, "running"],
      [3, "pending"],
      [4, "refused"],
    ]);
    expect(created.items[2]!.error).toBe("UNKNOWN_CHECK,FILE_NOT_SENT");

    // The first run fails at Orazaka: its row says so, and the next row starts.
    runs.set("run-batch-1", "FAILED");
    const next = await advanceBatch(account, created.id, { settings, now: new Date(), environment: "dev" });
    expect(next.items.map((i) => i.state)).toEqual(["failed", "running", "refused"]);
    expect(next.finishedAt).toBeNull();

    runs.set("run-batch-2", "SUCCEEDED");
    const done = await advanceBatch(account, created.id, { settings, now: new Date(), environment: "dev" });
    expect(done.items.map((i) => i.state)).toEqual(["failed", "done", "refused"]);
    expect(done.finishedAt).not.toBeNull();
  });

  it("an account that cannot pay pauses the pending rows with the reason, instead of failing them one by one", async () => {
    // A self-serve account (it accepted the terms) with no credit and its free audit spent: nothing left to pay a check with.
    await query("UPDATE accounts SET terms_accepted_at = now() WHERE id = $1", [account.id]);
    await seedAudits(account.id, { freeUsed: true });
    const settings = await settingsFor(account.id);
    const created = await createBatch(account, "Sans crédit", "file,check\nd.pdf,compliance\ne.pdf,compliance", [await pdf("d.pdf", "BAIL D"), await pdf("e.pdf", "BAIL E")], { settings, now: new Date(), environment: "dev" });
    expect(created.pausedBy).toBe("PAYWALL");
    expect(created.items.map((i) => i.state)).toEqual(["pending", "pending"]);
  });
});
