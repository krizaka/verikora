import { beforeAll, describe, expect, it } from "vitest";

import { startAnalysis } from "../analyses";
import { migrate, query } from "../db";
import { getDocument, listDocuments, storeDocument } from "../documents";
import { textPdf } from "../test-pdf";

/** The text is read after the upload answered (verikora#21). Against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const LEASE = [
  "BAIL DE LOGEMENT",
  "Loyer mensuel : 1 450 $, payable le premier jour du mois.",
  "Duree : 12 mois, du 1er juillet 2026 au 30 juin 2027.",
];
const file = { name: "bail.pdf", type: "application/pdf", size: 100 };
const COMPLIANCE = { studio: "compliance-check", jurisdiction: "QC" } as const;

describe.runIf(enabled)("a deferred upload (202 Accepted)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const account = async () =>
    (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`x-${Math.random().toString(36).slice(2)}@example.test`],
      )
    )[0]!.id;

  it("saves the row queued with no text, and the worker's reading completes it: text, pages, kind, title", async () => {
    const owner = await account();
    const { summary, finish } = await storeDocument(owner, file, textPdf(LEASE), "auto", undefined, undefined, {
      defer: true,
    });
    expect(summary).toMatchObject({ extraction: "queued", hasText: false, pages: 1 });
    expect(finish).toBeTypeOf("function");
    await finish!();
    const doc = await getDocument(owner, summary.id);
    expect(doc).toMatchObject({ extraction: "done", hasText: true, pages: 1, extractionError: null });
    expect(doc.text).toContain("Loyer mensuel");
    expect((await listDocuments(owner))[0]!.extraction).toBe("done");
  });

  it("a check waits for the text: 409 EXTRACTING while it is read", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, textPdf([...LEASE, "x"]), "lease", undefined, undefined, {
      defer: true,
    });
    await expect(startAnalysis(owner, summary.id, COMPLIANCE)).rejects.toMatchObject({
      status: 409,
      body: { code: "EXTRACTING" },
    });
  });

  it("keeps the reason on the row when the reading fails, and a second upload of the same file reads it again", async () => {
    const owner = await account();
    const bytes = textPdf([...LEASE, "y"]);
    const first = await storeDocument(owner, file, bytes, "lease", undefined, undefined, { defer: true });
    await query("UPDATE documents SET extraction = 'failed', extraction_error = 'FILE_TOO_COMPLEX' WHERE id = $1", [
      first.summary.id,
    ]);
    expect(await getDocument(owner, first.summary.id)).toMatchObject({
      extraction: "failed",
      extractionError: "FILE_TOO_COMPLEX",
    });
    await expect(startAnalysis(owner, first.summary.id, COMPLIANCE)).rejects.toMatchObject({
      status: 422,
      body: { code: "FILE_TOO_COMPLEX" },
    });
    const again = await storeDocument(owner, file, bytes, "lease", undefined, undefined, { defer: true });
    expect(again.summary.id).toBe(first.summary.id);
    expect(again.duplicate).toBe(false);
    await again.finish!();
    expect((await getDocument(owner, first.summary.id)).extraction).toBe("done");
  });

  it("shows a reading that never ended (the process restarted) as failed, never as an endless wait", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, textPdf([...LEASE, "z"]), "lease", undefined, undefined, {
      defer: true,
    });
    await query("UPDATE documents SET extraction_at = now() - interval '10 minutes' WHERE id = $1", [summary.id]);
    expect((await getDocument(owner, summary.id)).extraction).toBe("failed");
  });
});
