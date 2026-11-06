import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { accessTo, createGrant, listSharing, loadTarget, requestAccess, revokeGrant } from "./report-access";

/** The grants' SQL against a real PostgreSQL (CI's service; locally `DATABASE_IT=1 DATABASE_URL=… pnpm test`). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("report grants (database)", () => {
  const stamp = Date.now();
  const sha = stamp.toString(16).padStart(64, "0");
  const runId = `run-grants-${stamp}`;
  let owner: { id: string; email: string };
  let guest: { id: string; email: string };
  let documentId = "";
  let analysisId = "";

  beforeAll(async () => {
    await migrate();
    [owner] = (await query<{ id: string; email: string }>(
      "INSERT INTO accounts (email) VALUES ($1) RETURNING id, email",
      [`own-${stamp}@verikora.test`],
    )) as [typeof owner];
    [guest] = (await query<{ id: string; email: string }>(
      "INSERT INTO accounts (email) VALUES ($1) RETURNING id, email",
      [`guest-${stamp}@verikora.test`],
    )) as [typeof guest];
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, 'Bail', 'bail.txt', 'text/plain', 4, $2, 'bail') RETURNING id",
      [owner.id, sha],
    );
    documentId = doc!.id;
    const [a] = await query<{ id: string }>(
      "INSERT INTO analyses (document_id, studio, status, run_id, report, finished_at) VALUES ($1, 'compliance-check', 'succeeded', $2, '{}', now()) RETURNING id",
      [documentId, runId],
    );
    analysisId = a!.id;
  });

  it("finds the report by run id and document hash — and not by one alone", async () => {
    expect(await loadTarget(runId, sha)).toMatchObject({ analysisId, ownerId: owner.id });
    expect(await loadTarget(runId, "f".repeat(64))).toBeNull();
    expect(await loadTarget("other", sha)).toBeNull();
  });

  it("grants, lists (member), honours, expires, revokes", async () => {
    const now = new Date();
    expect(accessTo((await loadTarget(runId, sha))!, guest, now).allowed).toBe(false);
    const made = await createGrant(
      owner,
      documentId,
      analysisId,
      { email: guest.email.toUpperCase(), expiresAt: null },
      new Date(),
    );
    expect(made.member).toBe(true);
    expect(accessTo((await loadTarget(runId, sha))!, guest, now)).toMatchObject({ allowed: true, via: "grant" });
    expect((await listSharing(owner.id, documentId, analysisId, new Date())).grants[0]).toMatchObject({
      email: guest.email,
      status: "member",
    });
    // expired
    await query("UPDATE report_grants SET expires_at = now() - interval '1 minute' WHERE id = $1", [made.grantId]);
    expect(accessTo((await loadTarget(runId, sha))!, guest, new Date()).allowed).toBe(false);
    expect((await listSharing(owner.id, documentId, analysisId, new Date())).grants[0]!.status).toBe("expired");
    // renewed, then revoked
    const renewed = await createGrant(
      owner,
      documentId,
      analysisId,
      { email: guest.email, expiresAt: null },
      new Date(),
    );
    expect(accessTo((await loadTarget(runId, sha))!, guest, new Date()).allowed).toBe(true);
    await revokeGrant(owner.id, documentId, analysisId, renewed.grantId);
    expect(accessTo((await loadTarget(runId, sha))!, guest, new Date()).allowed).toBe(false);
  });

  it("an invitation for an address with no account waits, then is honoured when the account exists", async () => {
    const email = `later-${stamp}@verikora.test`;
    expect((await createGrant(owner, documentId, analysisId, { email, expiresAt: null }, new Date())).member).toBe(
      false,
    );
    expect(
      (await listSharing(owner.id, documentId, analysisId, new Date())).grants.find((g) => g.email === email)!.status,
    ).toBe("invited");
    const [later] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [email]);
    expect(accessTo((await loadTarget(runId, sha))!, { id: later!.id, email }, new Date()).allowed).toBe(true);
  });

  it("keeps sharing to the owner, refuses their own address and a past expiry", async () => {
    await expect(listSharing(guest.id, documentId, analysisId, new Date())).rejects.toMatchObject({ status: 404 });
    await expect(
      createGrant(guest, documentId, analysisId, { email: "x@y.test", expiresAt: null }, new Date()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createGrant(owner, documentId, analysisId, { email: owner.email, expiresAt: null }, new Date()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createGrant(owner, documentId, analysisId, { email: "z@y.test", expiresAt: new Date(0) }, new Date()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("records one access request, shown to the owner, and closes it when access is given", async () => {
    const stranger = { id: guest.id, email: `nope-${stamp}@verikora.test` };
    const [s] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [stranger.email]);
    const who = { id: s!.id, email: stranger.email };
    const target = (await loadTarget(runId, sha))!;
    expect(await requestAccess(who, target, new Date())).toEqual({ recorded: true });
    expect(await requestAccess(who, target, new Date())).toEqual({ recorded: false });
    expect((await listSharing(owner.id, documentId, analysisId, new Date())).requests.map((r) => r.email)).toContain(
      stranger.email,
    );
    await createGrant(owner, documentId, analysisId, { email: stranger.email, expiresAt: null }, new Date());
    expect(
      (await listSharing(owner.id, documentId, analysisId, new Date())).requests.map((r) => r.email),
    ).not.toContain(stranger.email);
    expect(await requestAccess(who, null, new Date())).toEqual({ recorded: false });
  });
});
