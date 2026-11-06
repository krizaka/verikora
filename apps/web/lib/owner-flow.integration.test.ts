import { memoryStore, type SovkoraRun } from "@verikora/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONSENT_MEANS, CONSENT_PURPOSE, grantConsent, NOTICE_VERSION } from "./applicant-consent";
import { applicantFileOf, requestApplicantFile, submitApplicantFile, uploadApplicantDocument } from "./applicant-file";
import { migrate, query } from "./db";
import type { AccountMail } from "./mailer";
import { SHARE_DEFAULT_DAYS } from "./owner-report";
import { createShare, emailShare, listShares, openShare, revokeShare } from "./owner-report-shares";
import { cleanPdf } from "./preflight/fixtures";
import { useSovkoraClient } from "./sovkora";

/**
 * verikora#130, the whole flow in one test against the real database (CI's service; locally DATABASE_IT=1 DATABASE_URL=…):
 * the agent asks, the applicant consents and uploads, the checks end, the originals are purged, the owner gets a link by e-mail and
 * opens only the report. Sovkora is a fake that records the runs.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-28T12:00:00Z");
const DAY_MS = 86_400_000;
const BANNED = /certificat|authentique|conforme|approuv|refus|certificate|authentic|compliant|approved|rejected/i;

describe.runIf(enabled)("from the applicant's upload to the owner's report (verikora#130)", () => {
  const runs = new Map<string, string>();
  let n = 0;
  const run = (id: string, status: string): SovkoraRun => ({
    id,
    studioKey: "x",
    blueprintVersion: "1.0.0",
    status,
    outputs: [],
  });
  const store = memoryStore();
  const stamp = Date.now();
  let agent: { id: string; email: string };

  beforeAll(async () => {
    await migrate();
    useSovkoraClient({
      startRun: async () => {
        const id = `run-flow-${++n}`;
        runs.set(id, "RUNNING");
        return run(id, "RUNNING");
      },
      getRun: async (id: string) => run(id, runs.get(id) ?? "RUNNING"),
    } as never);
    const email = `flow-${stamp}@verikora.test`;
    const [row] = await query<{ id: string }>(
      "INSERT INTO accounts (email, audit_credits) VALUES ($1, 50) RETURNING id",
      [email],
    );
    agent = { id: row!.id, email };
  });
  afterAll(async () => {
    useSovkoraClient(null);
    await query("DELETE FROM accounts WHERE id = $1", [agent.id]);
  });

  it("leaves no original anywhere, gives the owner the report by a link that expires, and audits each view", async () => {
    const made = await requestApplicantFile(
      agent,
      {
        candidateName: "Camille Fictif",
        candidateEmail: `c-${stamp}@exemple.test`,
        types: ["pay-stub", "bank-statement"],
      },
      NOW,
    );
    await grantConsent(
      made.id,
      CONSENT_PURPOSE.DOCUMENT_CHECK,
      { noticeVersion: NOTICE_VERSION, means: CONSENT_MEANS.WEB_FORM },
      NOW,
    );
    const context = {
      store,
      purgeAfterHours: 24,
      keepAllowed: true,
      auditCaps: () => ({ perMonth: 1000, perDay: 0, freeDossiers: 0, overageCents: 0 }),
    };
    for (const [type, text] of [
      ["pay-stub", "PAY FLOW"],
      ["bank-statement", "BANK FLOW"],
    ] as const) {
      const bytes = await cleanPdf(text);
      await uploadApplicantDocument(
        made.token,
        type,
        { name: `camille-${text}.pdf`, type: "application/pdf", size: bytes.length, bytes },
        context,
        NOW,
      );
    }
    await submitApplicantFile(made.token, NOW);
    for (const id of runs.keys()) {
      runs.set(id, "FAILED");
    }
    const view = await applicantFileOf(agent.id, made.id, NOW);
    expect(view.documents).toHaveLength(2);

    // No original remains: no byte, no text, no object on a store; only the hash row.
    const docs = await query<{ storage: string; bytes: number; text: string; sha256: string }>(
      "SELECT storage, octet_length(content) AS bytes, text, sha256 FROM documents WHERE screening_id = $1",
      [made.id],
    );
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d).toMatchObject({ storage: "none", bytes: 0, text: "", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
    expect(
      await query("SELECT 1 FROM audit.entry WHERE action = 'document.purged' AND target_id = ANY($1)", [
        view.documents.map((d) => d.id),
      ]),
    ).toHaveLength(2);

    // The owner link: 7 days by default, mailed once, opens only the redacted report.
    const sent: AccountMail[] = [];
    const share = await createShare(agent, made.id, { recipient: "Propriétaire" }, NOW);
    expect(new Date(share.expiresAt).getTime() - NOW.getTime()).toBe(SHARE_DEFAULT_DAYS * DAY_MS);
    await emailShare(
      { ...agent, name: null },
      made.id,
      { token: share.token, email: "owner@exemple.test", locale: "fr" },
      { mail: async (m) => void sent.push(m), origin: "https://www.verikora.com" },
      NOW,
    );
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).not.toMatch(/PAY FLOW|BANK FLOW|Camille/);

    const report = await openShare(share.token, new Date(NOW.getTime() + DAY_MS));
    expect(report?.documents.map((d) => d.sha256).sort()).toEqual(docs.map((d) => d.sha256).sort());
    const seen = JSON.stringify(report);
    expect(seen).not.toMatch(/Camille|camille|exemple\.test|PAY FLOW|BANK FLOW/);
    expect(seen).not.toMatch(BANNED);
    expect((await listShares(agent.id, made.id, NOW))[0]?.views).toBe(1);
    expect(
      await query("SELECT 1 FROM audit.entry WHERE action = 'report.viewed' AND target_id = $1", [made.id]),
    ).toHaveLength(1);

    // It expires by itself, and can be revoked before.
    expect(await openShare(share.token, new Date(NOW.getTime() + (SHARE_DEFAULT_DAYS + 1) * DAY_MS))).toBeNull();
    await revokeShare(agent, made.id, share.id);
    expect(await openShare(share.token, new Date(NOW.getTime() + DAY_MS))).toBeNull();
  });
});
