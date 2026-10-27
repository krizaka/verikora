import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { consent, contest, copyForTenant,decline, listForLandlord, purgeExpired, requestScreening, share, viewForTenant } from "./screening";
import { type BillingPort, chargeCheck, refundCheck } from "./screening-checks/billing";
import { collectOne, collectPending, dueChecks } from "./screening-checks/collect";
import { demoProvider } from "./screening-checks/providers";

/** The consent flow against a real PostgreSQL (CI's service; locally `YOMIZAKA_DB_IT=1 DATABASE_URL=… pnpm test`). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const DAY = 86_400_000;
/** The seeded global rule of « screening-result » (retention policy « thirty-days »): a row, not a constant. */
const RETENTION_DAYS = 30;

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
    const { id, token } = await ask(`g-${stamp}@exemple.test`, "Camille Flag");
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

  it("collects a pending check by polling: in progress first, then settled once, with an audit row and a copy for the applicant", async () => {
    const { id, token } = await ask(`j-${stamp}@exemple.test`, "Camille Wait");
    const view = await consent(token, NOW);
    expect(view.result).toMatchObject({ band: "incomplete", items: [{ key: "payment-history", outcome: "pending" }] });
    const [check] = await query<{ state: string; provider_ref: string; next_poll_at: Date }>("SELECT state, provider_ref, next_poll_at FROM screening_checks WHERE screening_id = $1", [id]);
    expect(check).toMatchObject({ state: "pending", provider_ref: "demo-pending-01" });
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect((await dueChecks(NOW, 50)).some((d) => d.screening_id === id)).toBe(false);
    const due = (await dueChecks(later, 50)).find((d) => d.screening_id === id)!;
    expect(await collectOne(due, demoProvider, later)).toBe(true);
    // A replay changes nothing twice.
    expect(await collectOne(due, demoProvider, later)).toBe(false);
    expect((await viewForTenant(token, later)).result).toMatchObject({ band: "no-concern", items: [{ key: "payment-history", outcome: "clear" }] });
    expect((await actions(id)).filter((a) => a === "screening.check.collected")).toHaveLength(1);
    const copy = await copyForTenant(token, { "payment-history": "Payment history" }, { outcome: { clear: "nothing to report" }, band: { "no-concern": "Nothing to report" }, keptUntil: "Deleted on {date}.", title: "Your result" }, later);
    expect(copy.text).toContain("- Payment history: nothing to report");
    expect(await actions(id)).toContain("screening.copy");
  });

  it("gives up a check that never answers, and the purge removes what the checks kept", async () => {
    const { id, token } = await ask(`k-${stamp}@exemple.test`, "Camille Waitforever");
    await consent(token, NOW);
    await query("UPDATE screening_provider SET poll_max = 2 WHERE id = 'demo'");
    try {
      let at = NOW;
      for (let n = 0; n < 3; n++) {
        at = new Date(at.getTime() + 16 * 60_000);
        await collectPending(at);
      }
    } finally {
      await query("UPDATE screening_provider SET poll_max = 96 WHERE id = 'demo'");
    }
    const [check] = await query<{ state: string; outcome: string }>("SELECT state, outcome FROM screening_checks WHERE screening_id = $1", [id]);
    expect(check).toMatchObject({ state: "unavailable", outcome: "TIMEOUT" });
    expect((await viewForTenant(token, NOW)).result?.items[0]?.outcome).toBe("unavailable");
    await purgeExpired(new Date(NOW.getTime() + (RETENTION_DAYS + 1) * DAY));
    expect(await query("SELECT 1 FROM screening_checks WHERE screening_id = $1", [id])).toHaveLength(0);
    expect(await actions(id)).toContain("screening.purged");
  });

  it("bills a check once with cost + margin and an invoice line, refunds it once, and bills nothing for a refusal (fixture port, test mode)", async () => {
    const charges: string[] = [];
    const port: BillingPort = { charge: async (r) => (charges.push(`${r.amountCents} ${r.description} ${r.taxCode}`), { ref: `fx_${charges.length}` }), refund: async (ref) => void charges.push(`refund ${ref}`) };
    const { id } = await ask(`l-${stamp}@exemple.test`);
    const [type] = await query<never>("SELECT * FROM check_type WHERE key = 'payment-history'");
    const priced = { ...(type as Record<string, unknown>), provider_cost_cents: 1200, margin_cents: 700 } as never;
    expect(await chargeCheck(port, { screeningId: id, type: priced, payer: "owner", description: "Vérification : Historique de paiement — service Krizaka" })).toBe("charged");
    expect(await chargeCheck(port, { screeningId: id, type: priced, payer: "owner", description: "x" })).toBe("duplicate");
    const [row] = await query<{ amount_cents: number; provider_cost_cents: number; margin_cents: number; state: string }>("SELECT amount_cents, provider_cost_cents, margin_cents, state FROM screening_charge WHERE screening_id = $1", [id]);
    expect(row).toEqual({ amount_cents: 1900, provider_cost_cents: 1200, margin_cents: 700, state: "charged" });
    expect(charges).toEqual(["1900 Vérification : Historique de paiement — service Krizaka software-as-a-service"]);
    expect(await refundCheck(port, id, "payment-history", NOW)).toBe(true);
    expect(await refundCheck(port, id, "payment-history", NOW)).toBe(false);
    expect(charges.at(-1)).toBe("refund fx_1");
    // Billing is off: a consent writes no charge.
    const { id: other, token } = await ask(`m-${stamp}@exemple.test`);
    await consent(token, NOW);
    expect(await query("SELECT 1 FROM screening_charge WHERE screening_id = $1", [other])).toHaveLength(0);
  });

  it("refuses the applicant as payer unless the check type allows it, and shows the tenant the price and the payer before consent", async () => {
    await expect(requestScreening(landlord, { tenantName: "X Y", tenantEmail: `n-${stamp}@exemple.test`, scope: ["payment-history"], payer: "applicant" }, NOW)).resolves.toBeDefined(); // free check: nothing to pay
    await query("UPDATE check_type SET margin_cents = 500 WHERE key = 'payment-history'");
    try {
      await expect(requestScreening(landlord, { tenantName: "X Y", tenantEmail: `o-${stamp}@exemple.test`, scope: ["payment-history"], payer: "applicant" }, NOW)).rejects.toMatchObject({ body: { code: "PAYER_NOT_ALLOWED" } });
      const { token } = await requestScreening(landlord, { tenantName: "X Y", tenantEmail: `p-${stamp}@exemple.test`, scope: ["payment-history"], payer: "firm" }, NOW);
      expect((await viewForTenant(token, NOW)).quote).toEqual({ lines: [{ key: "payment-history", cents: 500, currency: "CAD" }], totalCents: 500, payer: "firm" });
    } finally {
      await query("UPDATE check_type SET margin_cents = 0 WHERE key = 'payment-history'");
    }
  });

  it("keeps the criminal-record type as a disabled row, never requestable, even if an owner's row allows it", async () => {
    const [type] = await query<{ enabled: boolean; default_on: boolean; requires_lawyer: string }>("SELECT enabled, default_on, requires_lawyer FROM check_type WHERE key = 'criminal-record'");
    expect(type).toMatchObject({ enabled: false, default_on: false, requires_lawyer: "criminal-records-lawful" });
    await query("INSERT INTO tenant_check_setting (owner_id, check_type, allowed) VALUES ($1, 'criminal-record', true)", [landlord.id]);
    await expect(ask(`i-${stamp}@exemple.test`, "Camille Fictif", ["criminal-record"])).rejects.toMatchObject({ status: 400 });
    await query("DELETE FROM tenant_check_setting WHERE owner_id = $1", [landlord.id]);
  });

  it("the compliance gate: every blocker is open at first; done needs a date and a reference; the criminal type stays unrequestable until its blocker is done", async () => {
    const { gateState, loadGate } = await import("./screening-checks/gate");
    const { setBlocker } = await import("./compliance-gate");
    const open = await loadGate();
    expect(open.filter((r) => r.required_live).every((r) => r.status === "open")).toBe(true);
    expect(gateState(true, open).open).toBe(false);
    await expect(query("UPDATE compliance_gate SET status = 'done' WHERE blocker = 'efvp'")).rejects.toThrow();
    // Enabled and allowed by the owner's row, the type still waits for the lawyer's confirmation.
    await query("UPDATE check_type SET enabled = true WHERE key = 'criminal-record'");
    await query("INSERT INTO tenant_check_setting (owner_id, check_type, allowed) VALUES ($1, 'criminal-record', true) ON CONFLICT (owner_id, check_type) DO UPDATE SET allowed = true", [landlord.id]);
    try {
      await expect(ask(`q-${stamp}@exemple.test`, "Camille Fictif", ["criminal-record"])).rejects.toMatchObject({ status: 400 });
      await setBlocker({ id: landlord.id, email: landlord.email }, { blocker: "criminal-records-lawful", status: "done", evidenceOn: "2026-11-02", evidenceRef: "opinion letter" });
      await expect(ask(`r-${stamp}@exemple.test`, "Camille Fictif", ["criminal-record"])).resolves.toBeDefined();
    } finally {
      await setBlocker({ id: landlord.id, email: landlord.email }, { blocker: "criminal-records-lawful", status: "open" });
      await query("UPDATE check_type SET enabled = false WHERE key = 'criminal-record'");
      await query("DELETE FROM tenant_check_setting WHERE owner_id = $1", [landlord.id]);
    }
    expect(await query("SELECT 1 FROM audit_log WHERE action = 'compliance_gate.updated' AND actor_id = $1", [landlord.id])).not.toHaveLength(0);
  });

  it("the consent logs the notice version, the price and the payer it showed", async () => {
    const { id, token } = await ask(`s-${stamp}@exemple.test`);
    await consent(token, NOW);
    const [c] = await query<{ notice_version: string; price_cents: number; currency: string; payer: string }>("SELECT notice_version, price_cents, currency, payer FROM application_consents WHERE screening_id = $1", [id]);
    expect(c).toMatchObject({ price_cents: 0, currency: "CAD", payer: "owner" });
    expect(c!.notice_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("stores no raw report: the columns of a check hold a closed outcome, a reference and a run id — nothing else", async () => {
    const cols = await query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'screening_checks' ORDER BY column_name");
    expect(cols.map((c) => c.column_name)).toEqual(["answered_at", "category", "check_type", "id", "next_poll_at", "outcome", "polls", "provider_ref", "refusal", "run_id", "screening_id", "state", "submitted_at"]);
  });

  it("refuses an unknown link, and a scope the law does not allow", async () => {
    await expect(viewForTenant("sc1.not-a-real-token-at-all-0000000000", NOW)).rejects.toMatchObject({ status: 404 });
    await expect(requestScreening(landlord, { tenantName: "X", tenantEmail: "x@x.test", scope: ["criminal-record"] }, NOW)).rejects.toMatchObject({ status: 400 });
  });
});
