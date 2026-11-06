import { memoryStore, type SovkoraRun } from "@verikora/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CONSENT_MEANS, CONSENT_PURPOSE, grantConsent, NOTICE_VERSION } from "./applicant-consent";
import { requestApplicantFile, uploadApplicantDocument, type UploadContext } from "./applicant-file";
import { dossiersUsedThisMonth, entitlementOf, reserveAudit } from "./billing";
import { migrate, query } from "./db";
import { cleanPdf } from "./preflight/fixtures";
import { useSovkoraClient } from "./sovkora";

/**
 * The unit of billing is the dossier (krizaka-internal#45, slice A): all the documents and checks of one applicant are one
 * audit, whether it is the free one, a credit or the plan's included volume. Against the real database (CI's service; locally
 * DATABASE_IT=1 DATABASE_URL=…), Sovkora a fake.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-24T12:00:00Z");

describe.runIf(enabled)("the dossier is the unit of billing", () => {
  // The credits ledger reads the wall clock for a grant that "lapses in the future"; the tests pass NOW (24 Oct). Pinned like billing.integration.test.ts,
  // they no longer break once the real date passes the month's free pot (main red since 2026-11-01).
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  const store = memoryStore();
  const stamp = Date.now();
  let n = 0;
  const run = (id: string): SovkoraRun => ({
    id,
    studioKey: "x",
    blueprintVersion: "1.0.0",
    status: "RUNNING",
    outputs: [],
  });
  const ctx = (): UploadContext => ({
    store,
    purgeAfterHours: 24,
    keepAllowed: false,
    auditCaps: () => ({ perMonth: 1000, perDay: 0, freeDossiers: 1, overageCents: 0 }),
  });
  const selfServe = async (who: string) => {
    const email = `dossier-${who}-${stamp}@verikora.test`;
    const [row] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at, terms_accepted_at) VALUES ($1, 'x', now(), $2) RETURNING id",
      [email, NOW],
    );
    return { id: row!.id, email };
  };
  const pdf = async (text: string) => {
    const bytes = await cleanPdf(text);
    return { name: `${text}.pdf`, type: "application/pdf", size: bytes.length, bytes };
  };
  const ask = async (landlord: { id: string; email: string }, seq: number) => {
    const made = await requestApplicantFile(
      landlord,
      {
        candidateName: "Camille Fictif",
        candidateEmail: `c${seq}-${stamp}@exemple.test`,
        types: ["pay-stub", "employment-letter"],
      },
      NOW,
    );
    await grantConsent(
      made.id,
      CONSENT_PURPOSE.DOCUMENT_CHECK,
      { noticeVersion: NOTICE_VERSION, means: CONSENT_MEANS.WEB_FORM },
      NOW,
    );
    return made;
  };

  beforeAll(async () => {
    await migrate();
    useSovkoraClient({
      startRun: async () => run(`run-dossier-${++n}`),
      getRun: async (id: string) => run(id),
    } as never);
  });
  afterAll(() => useSovkoraClient(null));

  it("two documents of one applicant are one dossier: one free audit, the meter reads 1, the next applicant meets the paywall", async () => {
    const landlord = await selfServe("journey");
    const first = await ask(landlord, 1);
    await uploadApplicantDocument(first.token, "pay-stub", await pdf("DOSSIER PAY"), ctx(), NOW);
    await uploadApplicantDocument(first.token, "employment-letter", await pdf("DOSSIER LETTER"), ctx(), NOW);

    const billed = await query<{ billed_via: string | null }>(
      "SELECT a.billed_via FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1",
      [landlord.id],
    );
    expect(billed.length).toBeGreaterThanOrEqual(2);
    expect(billed.filter((b) => b.billed_via === "free")).toHaveLength(1);
    expect(billed.filter((b) => b.billed_via === "dossier")).toHaveLength(billed.length - 1);
    expect(await dossiersUsedThisMonth(query, landlord.id, new Date())).toBe(1);
    expect(await entitlementOf(query, landlord.id, new Date())).toMatchObject({ credits: 0, freeAuditUsed: true });

    // another applicant is another dossier: the free audit is gone and nothing pays for it
    const second = await ask(landlord, 2);
    const outcome = await uploadApplicantDocument(second.token, "pay-stub", await pdf("DOSSIER OTHER"), ctx(), NOW);
    expect(outcome.checks.started).toHaveLength(0);
    expect(outcome.checks.skipped.length).toBeGreaterThan(0);
  });

  it("a second check of a document billed this month spends nothing; a refunded first one does not cover it", async () => {
    const landlord = await selfServe("same-document");
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
      [landlord.id, `same-${stamp}`],
    );
    const caps = () => ({ perMonth: 100, perDay: 0, freeDossiers: 1, overageCents: 0 });
    const via = await reserveAudit(query, landlord.id, new Date(), caps, doc!.id);
    expect(via).toBe("free");
    await query(
      "INSERT INTO analyses (document_id, studio, status, billed_via) VALUES ($1, 'compliance-check', 'succeeded', $2)",
      [doc!.id, via],
    );
    expect(await reserveAudit(query, landlord.id, new Date(), caps, doc!.id)).toBe("dossier");
    await query("UPDATE analyses SET billed_via = 'free-refunded' WHERE document_id = $1", [doc!.id]);
    await expect(reserveAudit(query, landlord.id, new Date(), caps, doc!.id)).rejects.toMatchObject({ status: 402 });
  });

  it("the free dossier renews each calendar month, and the administrator's number is the allowance", async () => {
    const landlord = await selfServe("monthly");
    const oct = new Date("2026-10-10T12:00:00Z");
    const nov = new Date("2026-11-02T12:00:00Z");
    const doc = async (tag: string) => {
      const [d] = await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
        [landlord.id, `${tag}-${stamp}`],
      );
      return d!.id;
    };
    const two = () => ({ perMonth: 100, perDay: 0, freeDossiers: 2, overageCents: 0 });
    const first = await doc("m1");
    expect(await reserveAudit(query, landlord.id, oct, two, first)).toBe("free");
    expect(await reserveAudit(query, landlord.id, oct, two, await doc("m2"))).toBe("free");
    expect(await entitlementOf(query, landlord.id, oct)).toMatchObject({ freeAuditUsed: true });
    await expect(reserveAudit(query, landlord.id, oct, two, await doc("m3"))).rejects.toMatchObject({ status: 402 });
    // the 1st of the next month: the allowance is back, no card
    expect(await entitlementOf(query, landlord.id, nov)).toMatchObject({ freeAuditUsed: false });
    expect(await reserveAudit(query, landlord.id, nov, two, await doc("m4"))).toBe("free");
  });
});
