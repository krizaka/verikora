import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sealEnvelope } from "@krizaka/storage";
import { createProviderService, dbProviderStore, sha256Hex } from "@krizaka/storage/provider-admin";
import { beforeEach, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { dualObjectStore } from "./dual-read";
import { currentMove, MOVE_STATUS, type MoveDeps, setMovePaused, startMove, stepMove } from "./provider-move";
import { DATA_KIND, ORG_SCOPE } from "./providers";

/** ADR-005 §3 on PostgreSQL with two folder providers: the verified, resumable move and the dual read (skipped without DATABASE_IT=1 and DATABASE_URL). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-10-28T12:00:00Z");
const ADMIN = { id: null, label: "admin@verikora.test" };

describe.runIf(enabled)("the move of documents between providers", () => {
  const providers = dbProviderStore(query);
  const service = createProviderService({
    store: providers,
    vault: { keyId: "media-1", key: KEY, ring: { keys: { "media-1": KEY } } },
    clock: { now: () => NOW },
    newId: () => crypto.randomUUID(),
    audit: async () => undefined,
    open: {
      runtime: "dev",
      environment: "dev",
      fetch: async () => new Response(null, { status: 200 }),
      clock: { now: () => NOW },
    },
    probeId: () => crypto.randomUUID(),
    references: async (id) =>
      Number(
        (await query<{ n: string }>("SELECT count(*)::text AS n FROM documents WHERE provider_id = $1", [id]))[0]!.n,
      ),
  });
  const trail: string[] = [];
  const deps = (batch = 2): MoveDeps => ({
    q: query,
    service,
    defaults: () => providers.defaults(ORG_SCOPE),
    audit: async (n) => void trail.push(n.action),
    now: () => NOW,
    batch,
  });

  /** A folder provider, verified: `create` refuses a folder at org scope on purpose (dev only), so the row is inserted the way the bootstrap does. */
  const folder = async (label: string) => {
    const id = crypto.randomUUID();
    await providers.insert({
      id,
      scope: ORG_SCOPE,
      kind: "folder",
      preset: null,
      label,
      coordinates: { root: mkdtempSync(join(tmpdir(), "verikora-move-")) },
      sealedCredentials: sealEnvelope("{}", KEY, "media-1"),
      keyId: "media-1",
      status: "verified",
      source: "admin",
      lastTest: null,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return id;
  };

  let oldId = "";
  let newId = "";
  let owner = "";
  const documents: { id: string; key: string; bytes: Uint8Array }[] = [];

  beforeEach(async () => {
    await migrate();
    trail.length = 0;
    documents.length = 0;
    await query("DELETE FROM storage_moves");
    await query("DELETE FROM documents WHERE provider_id IS NOT NULL");
    await query("DELETE FROM storage.default_provider");
    await query("DELETE FROM storage.provider WHERE scope = 'org'");
    oldId = await folder("Old folder");
    newId = await folder("New folder");
    await service.setDefault(ADMIN, oldId, ORG_SCOPE, DATA_KIND.documents);
    owner = (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`m-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!.id;
    const old = await service.open(oldId);
    for (const n of [1, 2, 3, 4, 5]) {
      const bytes = new TextEncoder().encode(`document number ${n} ${"x".repeat(n)}`);
      const id = crypto.randomUUID();
      const key = `${owner}/${id}/original.txt`;
      await old.put(key, bytes, { contentType: "text/plain" });
      await query(
        `INSERT INTO documents (id, owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, object_key, text, storage, storage_owner, provider_id)
         VALUES ($1, $2, 'doc', 'doc.txt', 'text/plain', 'other', $3, $4, ''::bytea, $5, '', 'none', 'krizaka', $6)`,
        [id, owner, bytes.length, sha256Hex(bytes), key, oldId],
      );
      documents.push({ id, key, bytes });
    }
    await service.setDefault(ADMIN, newId, ORG_SCOPE, DATA_KIND.documents);
  });

  it("refuses a move to anything but the default, or from anything but a retiring provider", async () => {
    await expect(startMove(deps(), ADMIN, { from: newId, to: oldId })).rejects.toMatchObject({
      body: { code: "STORAGE_MOVE_NOT_ALLOWED" },
    });
    await expect(startMove(deps(), ADMIN, { from: oldId, to: oldId })).rejects.toMatchObject({
      body: { code: "STORAGE_MOVE_NOT_ALLOWED" },
    });
  });

  it("copies each object, verifies its SHA-256, then flips the row, batch by batch, until done", async () => {
    const started = await startMove(deps(), ADMIN, { from: oldId, to: newId });
    expect(started).toMatchObject({ status: MOVE_STATUS.running, total: 5, moved: 0, remaining: 5 });
    await stepMove(deps(2));
    expect(await currentMove(query)).toMatchObject({ status: MOVE_STATUS.running, moved: 2, remaining: 3 });
    await stepMove(deps(2));
    await stepMove(deps(2));
    expect(await currentMove(query)).toMatchObject({ status: MOVE_STATUS.done, moved: 5, remaining: 0, failed: [] });
    const rows = await query<{ provider_id: string }>("SELECT provider_id FROM documents WHERE owner_id = $1", [owner]);
    expect(rows.every((r) => r.provider_id === newId)).toBe(true);
    const fresh = await service.open(newId);
    for (const d of documents)
      expect(new TextDecoder().decode((await fresh.get(d.key))!.bytes)).toBe(new TextDecoder().decode(d.bytes));
    expect(trail).toEqual(["storage.move.started", "storage.move.completed"]);
  });

  it("is idempotent and resumable: a step on a finished move does nothing, a second start is refused while one is open", async () => {
    await startMove(deps(), ADMIN, { from: oldId, to: newId });
    await expect(startMove(deps(), ADMIN, { from: oldId, to: newId })).rejects.toMatchObject({
      body: { code: "STORAGE_MOVE_OPEN" },
    });
    await stepMove(deps(10));
    expect(await stepMove(deps(10))).toBeNull();
    expect((await currentMove(query))!.moved).toBe(5);
  });

  it("pauses and resumes: a paused move takes no step", async () => {
    await startMove(deps(), ADMIN, { from: oldId, to: newId });
    await stepMove(deps(2));
    await setMovePaused(deps(), ADMIN, true);
    expect(await stepMove(deps(2))).toBeNull();
    expect(await currentMove(query)).toMatchObject({ status: MOVE_STATUS.paused, moved: 2, remaining: 3 });
    await setMovePaused(deps(), ADMIN, false);
    await stepMove(deps(10));
    expect(await currentMove(query)).toMatchObject({ status: MOVE_STATUS.done, moved: 5 });
  });

  it("never flips a row whose copy does not match: it is listed as failed, the others go on, the row keeps reading from the old provider", async () => {
    const bad = documents[1]!;
    await query("UPDATE documents SET sha256 = $2 WHERE id = $1", [bad.id, "0".repeat(64)]);
    await startMove(deps(), ADMIN, { from: oldId, to: newId });
    await stepMove(deps(10));
    const move = (await currentMove(query))!;
    expect(move).toMatchObject({ status: MOVE_STATUS.attention, moved: 4, remaining: 0 });
    expect(move.failed).toHaveLength(1);
    expect(move.failed[0]).toMatchObject({ id: bad.id });
    expect(
      (await query<{ provider_id: string }>("SELECT provider_id FROM documents WHERE id = $1", [bad.id]))[0]!
        .provider_id,
    ).toBe(oldId);
    expect(trail).toContain("storage.move.failed");
  });

  it("reads new-then-old during the move: a document not yet moved is still served, one moved is served from the new provider", async () => {
    const dual = await dualObjectStore(service, newId, ORG_SCOPE);
    const [first, , , , last] = documents as [(typeof documents)[number], ...typeof documents];
    expect(new TextDecoder().decode((await dual.get(first.key))!.bytes)).toBe(new TextDecoder().decode(first.bytes));
    await startMove(deps(), ADMIN, { from: oldId, to: newId });
    await stepMove(deps(1));
    expect(new TextDecoder().decode((await dual.get(last.key))!.bytes)).toBe(new TextDecoder().decode(last.bytes));
    expect(await dual.get("nobody/none/original.txt")).toBeNull();
    // A delete reaches whichever provider still holds the file.
    await dual.delete(last.key);
    expect(await dual.get(last.key)).toBeNull();
  });
});
