import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { consent, contest, decline, listForLandlord, purgeExpired, requestScreening, RETENTION_DAYS, share, viewForTenant } from "./screening";

/** The consent flow against a real PostgreSQL (CI's service; locally `YOMIZAKA_DB_IT=1 DATABASE_URL=… pnpm test`). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const DAY = 86_400_000;

describe.runIf(enabled)("tenant screening (database)", () => {
  const stamp = Date.now();
  const NOW = new Date("2026-10-17T12:00:00Z");
  let landlord: { id: string; email: string };

  beforeAll(async () => {
    await migrate();
    [landlord] = (await query<{ id: string; email: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id, email", [`screening-landlord-${stamp}@yomizaka.test`])) as [typeof landlord];
  });

  const ask = (email: string, tenantName = "Camille Fictif", scope: string[] = ["payment-history"]) => requestScreening(landlord, { tenantName, tenantEmail: email, scope }, NOW);
  const actions = async (id: string) => (await query<{ action: string }>("SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id", [id])).map((a) => a.action);

  it("keeps only the token's hash, and the landlord sees a request waiting — no result", async () => {
    const { id, token } = await ask(`a-${stamp}@exemple.test`);
    const [row] = await query<{ token_hash: string }>("SELECT token_hash FROM screenings WHERE id = $1", [id]);
    expect(row!.token_hash).not.toContain(token);
    const list = await listForLandlord(landlord.id, NOW);
    expect(list.find((s) => s.id === id)).toMatchObject({ status: "requested", result: null });
    expect(await actions(id)).toEqual(["screening.requested"]);
  });

  it("a refusal is recorded and checks nothing", async () => {
    const { id, token } = await ask(`b-${stamp}@exemple.test`);
    expect(await decline(token, NOW)).toMatchObject({ status: "declined", result: null });
    const [row] = await query<{ result: unknown }>("SELECT result FROM screenings WHERE id = $1", [id]);
    expect(row!.result).toBeNull();
    await expect(consent(token, NOW)).rejects.toMatchObject({ status: 409 });
    expect(await actions(id)).toEqual(["screening.requested", "screening.declined"]);
  });

  it("consent runs the provider; the tenant sees the result first, the landlord only once it is shared", async () => {
    const { id, token } = await ask(`c-${stamp}@exemple.test`);
    const mine = await consent(token, NOW);
    expect(mine).toMatchObject({ status: "consented", landlord: landlord.email, result: { band: "no-concern", provider: "demo" } });
    expect((await listForLandlord(landlord.id, NOW)).find((s) => s.id === id)).toMatchObject({ status: "consented", result: null });
    await share(token, NOW);
    expect((await listForLandlord(landlord.id, NOW)).find((s) => s.id === id)).toMatchObject({ status: "shared", result: { band: "no-concern" } });
    // The consent for the purpose is recorded before the provider runs (yomizaka#131): one active row, with the notice version.
    expect(await actions(id)).toEqual(["screening.requested", "consent.granted", "screening.consented", "screening.shared"]);
    const [consentRow] = await query<{ purpose: string; notice_version: string; withdrawn_at: Date | null }>("SELECT purpose, notice_version, withdrawn_at FROM application_consents WHERE screening_id = $1", [id]);
    expect(consentRow).toMatchObject({ purpose: "COURT_RECORDS", withdrawn_at: null });
    expect(consentRow!.notice_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("stores a minimal result: no raw report, no score, no identity beyond the request", async () => {
    const { id, token } = await ask(`d-${stamp}@exemple.test`);
    await consent(token, NOW);
    const [row] = await query<{ result: Record<string, unknown>; result_expires_at: Date }>("SELECT result, result_expires_at FROM screenings WHERE id = $1", [id]);
    expect(Object.keys(row!.result).sort()).toEqual(["band", "generatedAt", "items", "provider"]);
    expect(row!.result_expires_at.getTime() - NOW.getTime()).toBe(RETENTION_DAYS * DAY);
  });

  it("a contested result is never shown to the landlord, who sees « contested »", async () => {
    const { id, token } = await ask(`g-${stamp}@exemple.test`, "Flag Fictif");
    expect((await consent(token, NOW)).result?.band).toBe("review");
    await contest(token, "Ce n'est pas exact.", NOW);
    const seen = (await listForLandlord(landlord.id, NOW)).find((s) => s.id === id)!;
    expect(seen).toMatchObject({ status: "contested", result: null });
    expect(JSON.stringify(seen)).not.toContain("pas exact");
    expect(await viewForTenant(token, NOW)).toMatchObject({ status: "contested", contestComment: "Ce n'est pas exact." });
    await expect(share(token, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("deletes the result after the retention window (the fact of the request stays) and expires an unanswered request", async () => {
    const consented = await ask(`e-${stamp}@exemple.test`);
    await consent(consented.token, NOW);
    const unanswered = await ask(`f-${stamp}@exemple.test`);
    const later = new Date(NOW.getTime() + (RETENTION_DAYS + 1) * DAY);
    expect(await purgeExpired(later)).toBeGreaterThanOrEqual(1);
    const [kept] = await query<{ result: unknown; purged_at: Date | null; status: string }>("SELECT result, purged_at, status FROM screenings WHERE id = $1", [consented.id]);
    expect(kept).toMatchObject({ result: null, status: "consented" });
    expect(kept!.purged_at).not.toBeNull();
    const [open] = await query<{ status: string }>("SELECT status FROM screenings WHERE id = $1", [unanswered.id]);
    expect(open!.status).toBe("expired");
    expect(await actions(consented.id)).toContain("screening.purged");
  });

  it("offers only the types the owner's row allows: credit needs a row, then runs and says « not available yet » while no provider account exists", async () => {
    await expect(ask(`h-${stamp}@exemple.test`, "Camille Fictif", ["credit"])).rejects.toMatchObject({ status: 400 });
    await query("INSERT INTO tenant_check_setting (owner_id, check_type, allowed) VALUES ($1, 'credit', true)", [landlord.id]);
    const { id, token } = await ask(`h-${stamp}@exemple.test`, "Camille Fictif", ["payment-history", "credit"]);
    const view = await consent(token, NOW);
    expect(view.result).toMatchObject({ band: "incomplete", items: [{ key: "payment-history", outcome: "clear" }, { key: "credit", outcome: "soon" }] });
    const checks = await query<{ check_type: string; state: string; outcome: string; refusal: string | null }>("SELECT check_type, state, outcome, refusal FROM screening_checks WHERE screening_id = $1 ORDER BY check_type", [id]);
    expect(checks).toEqual([
      { check_type: "credit", state: "soon", outcome: "REFUSED", refusal: "NOT_CONFIGURED" },
      { check_type: "payment-history", state: "answered", outcome: "NO_MATCH", refusal: null },
    ]);
    const purposes = await query<{ purpose: string }>("SELECT purpose FROM application_consents WHERE screening_id = $1 ORDER BY purpose", [id]);
    expect(purposes.map((p) => p.purpose)).toEqual(["COURT_RECORDS", "CREDIT"]);
    await query("DELETE FROM tenant_check_setting WHERE owner_id = $1", [landlord.id]);
  });

  it("keeps the criminal-record type as a disabled row, never requestable, even if an owner's row allows it", async () => {
    const [type] = await query<{ enabled: boolean; default_on: boolean; requires_lawyer: string }>("SELECT enabled, default_on, requires_lawyer FROM check_type WHERE key = 'criminal-record'");
    expect(type).toMatchObject({ enabled: false, default_on: false, requires_lawyer: "criminal-records-lawful" });
    await query("INSERT INTO tenant_check_setting (owner_id, check_type, allowed) VALUES ($1, 'criminal-record', true)", [landlord.id]);
    await expect(ask(`i-${stamp}@exemple.test`, "Camille Fictif", ["criminal-record"])).rejects.toMatchObject({ status: 400 });
    await query("DELETE FROM tenant_check_setting WHERE owner_id = $1", [landlord.id]);
  });

  it("stores no raw report: the columns of a check hold a closed outcome, a reference and a run id — nothing else", async () => {
    const cols = await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'screening_checks' ORDER BY column_name");
    expect(cols.map((c) => c.column_name)).toEqual(["answered_at", "category", "check_type", "id", "outcome", "provider_ref", "refusal", "run_id", "screening_id", "state", "submitted_at"]);
  });

  it("refuses an unknown link, and a scope the law does not allow", async () => {
    await expect(viewForTenant("sc1.not-a-real-token-at-all-0000000000", NOW)).rejects.toMatchObject({ status: 404 });
    await expect(requestScreening(landlord, { tenantName: "X", tenantEmail: "x@x.test", scope: ["criminal-record"] }, NOW)).rejects.toMatchObject({ status: 400 });
  });
});
