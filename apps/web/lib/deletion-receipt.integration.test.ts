import { memoryStore } from "@verikora/core";
import { beforeAll, describe, expect, it } from "vitest";

import { eraseApplication } from "./applicant-consent";
import { purgeApplicationFiles } from "./applicant-file";
import { migrate, query } from "./db";
import { verifyDeletionReceipt } from "./deletion-receipt";
import { signingKey } from "./report-signer";
import { purgeDocument } from "./retention";
import { requestScreening } from "./screening";

/** krizaka-internal#3381 against the real database (DATABASE_IT=1 DATABASE_URL=…): a receipt only once the store confirms the object is gone. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-11-13T12:00:00Z");
const SHA = "d".repeat(64);

describe.runIf(enabled)("a deletion receipt for every purged or erased file (krizaka-internal#3381)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const stamp = Date.now();
  const landlord = async () =>
    (
      await query<{ id: string; email: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id, email",
        [`rc-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!;
  const store = () => memoryStore({ kind: "bunny", devOnly: true, owner: "krizaka", residency: "elsewhere" });
  /** A document whose bytes are in the store under its key. `screening` links it to an applicant file. */
  const held = async (owner: string, s: ReturnType<typeof store>, screening: string | null = null, keep = false) => {
    const id = (
      await query<{ id: string }>(
        `INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, text, storage, screening_id)
         VALUES ($1, 'Camille Fictif bail', 'camille-bail.txt', 'text/plain', 'lease', 9, $2, ''::bytea, 'Loyer', $3, $4) RETURNING id`,
        [owner, SHA, keep ? "bunny" : "none", screening],
      )
    )[0]!.id;
    const key = `${owner}/${id}/original.txt`;
    await s.put(key, new TextEncoder().encode("bail text"), { contentType: "text/plain" });
    await query("UPDATE documents SET object_key = $2 WHERE id = $1", [id, key]);
    return id;
  };
  const receipts = (documentId: string) =>
    query<{ body: string; owner_id: string; rule: string }>(
      "SELECT body, owner_id, rule FROM deletion_receipts WHERE document_id = $1",
      [documentId],
    );
  const application = async (owner: { id: string; email: string }) =>
    (
      await requestScreening(
        owner,
        {
          tenantName: "Camille Fictif",
          tenantEmail: `c-${stamp}-${Math.random()}@exemple.test`,
          scope: ["payment-history"],
        },
        NOW,
      )
    ).id;
  const brokenOf = (s: ReturnType<typeof store>) =>
    ({ ...s, delete: async () => Promise.reject(new Error("store down")) }) as typeof s;

  it("a retention purge gives one receipt that verifies with the report's key and holds no name", async () => {
    const owner = await landlord();
    const s = store();
    const id = await held(owner.id, s);
    expect(await purgeDocument(query, id, "after-check", async () => s)).toBe(true);
    const [r, ...rest] = await receipts(id);
    expect(rest).toEqual([]);
    expect(r!.owner_id).toBe(owner.id);
    const v = verifyDeletionReceipt(r!.body, signingKey());
    expect(v.ok).toBe(true);
    if (!v.ok) {
      return;
    }
    expect(v.payload.rule).toBe("after-check");
    expect(v.payload.document).toBe(id);
    expect(v.payload.objects.some((o) => o.kind === "file" && o.sha256 === SHA && o.result === "deleted")).toBe(true);
    expect(r!.body).not.toMatch(/Camille|camille|@|bail\.txt/);
  });

  it("an erasure by the applicant gives one receipt per document, after the store deleted the object", async () => {
    const owner = await landlord();
    const s = store();
    const app = await application(owner);
    const id = await held(owner.id, s, app);
    const key = `${owner.id}/${id}/original.txt`;
    await eraseApplication(app, owner.id, s, NOW);
    expect(await s.get(key)).toBeNull();
    const [r, ...rest] = await receipts(id);
    expect(rest).toEqual([]);
    expect(r!.rule).toBe("applicant-request");
    expect(verifyDeletionReceipt(r!.body, signingKey())).toMatchObject({ ok: true });
  });

  it("the manager's decision purges the file and gives a receipt", async () => {
    const owner = await landlord();
    const s = store();
    const app = await application(owner);
    const id = await held(owner.id, s, app, true);
    await purgeApplicationFiles(owner.id, app, s);
    const [r] = await receipts(id);
    expect(r?.rule).toBe("after-decision");
  });

  it("a store delete that fails gives no receipt and keeps the file for the next sweep", async () => {
    const owner = await landlord();
    const s = store();
    const id = await held(owner.id, s);
    expect(await purgeDocument(query, id, "after-check", async () => brokenOf(s))).toBe(false);
    expect(await receipts(id)).toEqual([]);
    expect(await purgeDocument(query, id, "after-check", async () => s)).toBe(true);
    expect(await receipts(id)).toHaveLength(1);
  });

  it("an erasure whose store delete fails gives no receipt", async () => {
    const owner = await landlord();
    const s = store();
    const app = await application(owner);
    const id = await held(owner.id, s, app);
    await expect(eraseApplication(app, owner.id, brokenOf(s), NOW)).rejects.toBeTruthy();
    expect(await receipts(id)).toEqual([]);
  });
});
