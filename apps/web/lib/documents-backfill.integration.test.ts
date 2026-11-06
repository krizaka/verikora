import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { backfillDocuments } from "./documents-backfill";
import { objectKey } from "./retention";
import { memoryStore } from "./storage/memory";

/** ADR-0012 step 4 against a real PostgreSQL (skipped without the database test switch). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const BYTES = new TextEncoder().encode("BAIL DE LOGEMENT\nLoyer mensuel : 1 450 $.\n");
const SHA = createHash("sha256").update(BYTES).digest("hex");

describe.runIf(enabled)("documents backfill (ADR-0012)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const store = () => memoryStore({ kind: "none", devOnly: true, owner: "krizaka", residency: "elsewhere" });
  const holder = (s: ReturnType<typeof store>) => async () => s;
  const legacy = async (sha = SHA) => {
    const [owner] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
      [`b-${Math.random().toString(36).slice(2)}@verikora.test`],
    );
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, text, storage) VALUES ($1, 'bail', 'bail.txt', 'text/plain', 'lease', $2, $3, $4, 'Loyer', 'database') RETURNING id",
      [owner!.id, BYTES.length, sha, Buffer.from(BYTES)],
    );
    return { owner: owner!.id, id: doc!.id, key: objectKey(owner!.id, doc!.id, "text/plain") };
  };
  const row = async (id: string) =>
    (
      await query<{ object_key: string | null; n: number }>(
        "SELECT object_key, octet_length(content) AS n FROM documents WHERE id = $1",
        [id],
      )
    )[0]!;

  it("a dry run reports what it would move and writes nothing", async () => {
    const s = store();
    const d = await legacy();
    const result = await backfillDocuments(query, holder(s), { dryRun: true, limit: 1000 });
    expect(result).toMatchObject({ dryRun: true, copied: 0 });
    expect(result.candidates).toBeGreaterThanOrEqual(1);
    expect(await row(d.id)).toMatchObject({ object_key: null, n: BYTES.length });
    expect(s.size()).toBe(0);
  });

  it("copies the bytes to the store, checks them against the SHA-256, then empties the column; a second run finds nothing", async () => {
    const s = store();
    const d = await legacy();
    const result = await backfillDocuments(query, holder(s), { limit: 1000 });
    expect(result.failed).not.toContain(d.id);
    expect(result.copied).toBeGreaterThanOrEqual(1);
    expect(await row(d.id)).toEqual({ object_key: d.key, n: 0 });
    expect(new Uint8Array((await s.get(d.key))!.bytes)).toEqual(BYTES);
    const again = await backfillDocuments(query, holder(s), { limit: 1000 });
    expect(again.copied).toBe(0);
    expect(await row(d.id)).toEqual({ object_key: d.key, n: 0 });
  });

  it("leaves a row whose bytes do not match its SHA-256 untouched, and removes the copy it made", async () => {
    const s = store();
    const d = await legacy("0".repeat(64));
    const result = await backfillDocuments(query, holder(s), { limit: 1000 });
    expect(result.failed).toContain(d.id);
    expect(await row(d.id)).toEqual({ object_key: null, n: BYTES.length });
    expect(await s.get(d.key)).toBeNull();
    await query("DELETE FROM documents WHERE id = $1", [d.id]);
  });

  it("leaves the row for the next run when the store does not answer", async () => {
    const s = store();
    const d = await legacy();
    const broken = {
      ...s,
      put: async () => {
        throw new Error("store down");
      },
    };
    const result = await backfillDocuments(query, async () => broken, { limit: 1000 });
    expect(result.failed).toContain(d.id);
    expect(await row(d.id)).toEqual({ object_key: null, n: BYTES.length });
    expect((await backfillDocuments(query, holder(s), { limit: 1000 })).copied).toBeGreaterThanOrEqual(1);
    expect((await row(d.id)).object_key).toBe(d.key);
  });
});
