import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { refresh } from "./analyses";
import { addPurchased } from "./audit-credits";
import { entitlementOf, reserveAudit } from "./billing";
import { coupons } from "./coupons/instance";
import { redeemCreditCode } from "./coupons/pilot";
import { migrate, query, transaction } from "./db";
import type { AnalysisRow } from "./documents";
import { appSettings } from "./settings/instance";
import { GLOBAL } from "./settings/service";

/**
 * A run that fails gives the file's credit back, once, and says so (krizaka-internal#3375, SOV-105): the paid credit, the pilot credit,
 * a replay of the same failure, and a run that is not over yet (nothing is given back). Real PostgreSQL; Sovkora is not called.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date();
const ADMIN = { id: null, label: "admin@verikora.test" };
const audits: { action: string; targetId?: string | null }[] = [];

vi.mock("./audit", async (original) => ({
  ...(await original<typeof import("./audit")>()),
  audit: async (entry: { action: string }) => void audits.push(entry),
}));
vi.mock("./sovkora", () => ({
  sovkora: () => ({ getRun: async () => ({ id: "x", studioKey: "s", status: "RUNNING", outputs: [] }) }),
}));

const caps = () => ({ perMonth: 100, perDay: 0, freeDossiers: 0, overageCents: 0 });

describe.runIf(enabled)("a failed run gives the credit back (#3375)", () => {
  beforeAll(async () => {
    await migrate();
    await appSettings().set(ADMIN, GLOBAL, "coupons.enabled", true, NOW);
  });
  const account = async () =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), now()) RETURNING id",
        [`r-${randomUUID()}@verikora.test`],
      )
    )[0]!.id;
  const paidAccount = async () => {
    const id = await account();
    await transaction((tx) => addPurchased(tx, id, 1, `pay-${randomUUID()}`));
    return id;
  };
  const runningRow = async (owner: string, via: string) => {
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
      [owner, randomUUID()],
    );
    const [row] = await query<AnalysisRow>(
      "INSERT INTO analyses (document_id, studio, status, run_id, billed_via) VALUES ($1, 'document-authenticity', 'running', $2, $3) RETURNING *",
      [doc!.id, `run-${randomUUID()}`, via],
    );
    return row!;
  };
  const ended = (id: string, status: string, errorMessage: string) => ({
    id,
    studioKey: "document-authenticity",
    status,
    outputs: [],
    errorMessage,
  });
  const credits = async (id: string) => (await entitlementOf(query, id, NOW)).credits;

  it("a paid credit comes back once, with an audit line and the flag the file page reads", async () => {
    const id = await paidAccount();
    const via = await reserveAudit(query, id, NOW, caps);
    expect(via).toBe("credit");
    expect(await credits(id)).toBe(0);
    const row = await runningRow(id, via);
    audits.length = 0;
    const done = await refresh(row, ended(row.run_id!, "FAILED", "engine error"));
    expect(done).toMatchObject({ status: "failed", creditRestored: true });
    expect(await credits(id)).toBe(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "billing.audit_refunded", targetId: row.id });
  });

  it("the same failure replayed restores nothing more and writes no second audit line", async () => {
    const id = await paidAccount();
    const row = await runningRow(id, await reserveAudit(query, id, NOW, caps));
    await refresh(row, ended(row.run_id!, "FAILED", "engine error"));
    audits.length = 0;
    const again = await refresh(row, ended(row.run_id!, "FAILED", "engine error"));
    expect(await credits(id)).toBe(1);
    expect(audits).toHaveLength(0);
    expect(again.creditRestored, "the file still says its credit is back").toBe(true);
  });

  it("a pilot credit comes back too (a refused run and a cancelled one alike)", async () => {
    const id = await account();
    const c = await transaction((tx) =>
      coupons.admin.create(tx, ADMIN, {
        code: `P${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
        kind: "credit",
        purpose: "demo",
        startsAt: new Date(NOW.getTime() - 86_400_000),
        credits: 2,
        creditsValidDays: 30,
        capPerDay: 3,
        maxRedemptions: 5,
        onExhausted: "stop",
      }),
    );
    await redeemCreditCode({ code: c.code, accountId: id, idempotencyKey: `t-${randomUUID()}`, ip: "10.1.1.1" });
    for (const [status, message] of [
      ["FAILED", "Sovkora refused the document as sent"],
      ["CANCELLED", "cancelled"],
    ] as const) {
      const before = await credits(id);
      const row = await runningRow(id, await reserveAudit(query, id, NOW, caps));
      expect(await credits(id)).toBe(before - 1);
      const done = await refresh(row, ended(row.run_id!, status, message));
      expect(done.creditRestored).toBe(true);
      expect(await credits(id)).toBe(before);
    }
  });

  it("a run that is not over yet gives nothing back", async () => {
    const id = await paidAccount();
    const row = await runningRow(id, await reserveAudit(query, id, NOW, caps));
    audits.length = 0;
    const same = await refresh(row);
    expect(same.status).toBe("running");
    expect(same.creditRestored).toBeUndefined();
    expect(await credits(id)).toBe(0);
    expect(audits).toHaveLength(0);
  });
});
