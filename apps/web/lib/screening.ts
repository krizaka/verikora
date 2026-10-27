import crypto from "node:crypto";

import { addMinutes } from "@krizaka/time";
import { z } from "zod";

import { CONSENT_MEANS, grantConsent, NOTICE_VERSION, purposesOfTypes, requireConsent } from "./applicant-consent";
import { audit } from "./audit";
import { query } from "./db";
import { refuse } from "./http";
import { getDictionary } from "./i18n";
import { policyFor, resultDays, SUBJECT } from "./retention-policy";
import { chargeCheck, invoiceLine, isChargeable, PAYER, type Payer, payerAllowed, quoteOf, totalCents } from "./screening-checks/billing";
import { screeningBillingPort } from "./screening-checks/billing-config";
import { allowedFor, type CheckTypeRow, priceCents, providerById, typesByKey } from "./screening-checks/catalogue";
import { CHECK_STATE, type CheckResult, type CheckState, stateOf } from "./screening-checks/model";
import { adapterFor, type CheckProvider } from "./screening-checks/providers";

/*
 * Checking a tenant's application (« dossier ») — provider-agnostic, with explicit tenant consent
 * (docs/product/tenant-screening-research.md). The landlord asks; the TENANT consents or declines, sees the result FIRST and
 * shares it or contests it. Minimal data: a short summary, never a provider's raw report, deleted after the retention window.
 * What may be asked is DATA (check types and each owner's row, lib/screening-checks): a type is offered only while its row is enabled and
 * allowed for the owner. The sensitive type stays off until the compliance gate says a lawyer confirmed it (yomizaka#135).
 */
export const SCREENING_STATUS = { requested: "requested", consented: "consented", shared: "shared", declined: "declined", contested: "contested", expired: "expired", erased: "erased" } as const;
export type ScreeningStatus = (typeof SCREENING_STATUS)[keyof typeof SCREENING_STATUS];

// @fixed: the days a request can be answered — a tenant needs time to read it; two weeks, then it expires unanswered.
export const REQUEST_VALID_DAYS = 14;

/** What one check shows: an answered check says « clear » or « to review »; one that has not answered says why, never a guess. */
export const screeningItem = z.object({ key: z.string().min(1).max(40), outcome: z.enum(["clear", "review", "pending", "unavailable", "soon"]) });
/** What is kept of a provider's answer: a band and a few items — nothing else. No score, no account, no address. */
export const screeningResult = z.object({ band: z.enum(["no-concern", "review", "incomplete"]), items: z.array(screeningItem).max(8), provider: z.string(), generatedAt: z.string() });
export type ScreeningResult = z.infer<typeof screeningResult>;

/** The provider id the pages call fictitious. */
export const DEMO_PROVIDER = "demo";

/** One check's line: MATCH is « to review » (a file found is not a verdict), NO_MATCH « clear », the rest says where it stands. Pure. */
export function itemOf(key: string, result: Pick<CheckResult, "outcome" | "refusal">): z.infer<typeof screeningItem> {
  const state: CheckState = stateOf(result);
  if (state === CHECK_STATE.answered) return { key, outcome: result.outcome === "MATCH" ? "review" : "clear" };
  return { key, outcome: state };
}
/** Pure: the band of a set of lines. A line to review wins; otherwise any check not answered keeps the whole « incomplete » — never « nothing to report ». */
export const bandOf = (items: readonly { outcome: string }[]): ScreeningResult["band"] => (items.some((i) => i.outcome === "review") ? "review" : items.every((i) => i.outcome === "clear") ? "no-concern" : "incomplete");

/** « Camille Fictif » → first name, last name (the rest). The engine searches by names; Yomizaka keeps no more than the application already holds. */
export function namesOf(fullName: string): { firstName: string; lastName: string } {
  const [first = "", ...rest] = fullName.trim().split(/\s+/);
  return { firstName: first, lastName: rest.join(" ") || first };
}

/** The token is 256 random bits: a plain SHA-256 is enough to keep only its hash (nothing to guess, nothing to key). */
export const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** `n` days after `from`, in UTC (calendar days, no millisecond arithmetic). */
export const addDays = (from: Date, n: number): Date => {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
export const newToken = () => `sc1.${crypto.randomBytes(32).toString("base64url")}`;

interface Row {
  id: string;
  flow: string;
  landlord_id: string;
  tenant_name: string;
  tenant_email: string;
  scope: string[];
  provider: string;
  status: ScreeningStatus;
  created_at: Date;
  expires_at: Date;
  consented_at: Date | null;
  shared_at: Date | null;
  contested_at: Date | null;
  contest_comment: string | null;
  landlord_email?: string;
  result: unknown;
  result_expires_at: Date | null;
  purged_at: Date | null;
  /** The applicant file's link (yomizaka#127); null for a screening. */
  revoked_at: Date | null;
  submitted_at: Date | null;
  closed_at: Date | null;
  payer?: Payer;
}

/** What the landlord sees: the result only once the tenant has shared it. A contested result is never shown. */
export interface LandlordView {
  id: string;
  tenantName: string;
  tenantEmail: string;
  status: ScreeningStatus;
  createdAt: string;
  expiresAt: string;
  result: ScreeningResult | null;
  provider: string;
  demo: boolean;
}
/** What the tenant sees: the request, and their result as soon as they consented. */
export interface TenantView {
  status: ScreeningStatus;
  /** Who asks — the tenant must know to consent. */
  landlord: string;
  tenantName: string;
  scope: string[];
  provider: string;
  demo: boolean;
  expiresAt: string;
  retentionDays: number;
  result: ScreeningResult | null;
  resultExpiresAt: string | null;
  contestComment: string | null;
  /** What each check costs and who pays, shown before the applicant consents (yomizaka#133). Prices are data; taxes are added where they apply. */
  quote: { lines: { key: string; cents: number; currency: string }[]; totalCents: number; payer: Payer };
}

const parseResult = (r: unknown): ScreeningResult | null => {
  const p = screeningResult.safeParse(r);
  return p.success ? p.data : null;
};

/** The state of a request as of now: a pending one past its date is expired; a result past its retention is deleted. Pure. */
export function effectiveState(row: Pick<Row, "status" | "expires_at" | "result_expires_at">, now: Date): { status: ScreeningStatus; resultAlive: boolean } {
  const resultAlive = row.result_expires_at === null || row.result_expires_at.getTime() > now.getTime();
  const pending = row.status === SCREENING_STATUS.requested;
  return { status: pending && row.expires_at.getTime() <= now.getTime() ? SCREENING_STATUS.expired : row.status, resultAlive };
}

export const landlordView = (row: Row, now: Date): LandlordView => {
  const state = effectiveState(row, now);
  const visible = state.status === SCREENING_STATUS.shared && state.resultAlive;
  return { id: row.id, tenantName: row.tenant_name, tenantEmail: row.tenant_email, status: state.status, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), result: visible ? parseResult(row.result) : null, provider: row.provider, demo: row.provider === DEMO_PROVIDER };
};
export const tenantView = (row: Row, now: Date, quote: TenantView["quote"] = { lines: [], totalCents: 0, payer: row.payer ?? PAYER.owner }, retentionDays = 0): TenantView => {
  const state = effectiveState(row, now);
  return { status: state.status, landlord: row.landlord_email ?? "", tenantName: row.tenant_name, scope: row.scope, provider: row.provider, demo: row.provider === DEMO_PROVIDER, expiresAt: row.expires_at.toISOString(), retentionDays, result: state.resultAlive ? parseResult(row.result) : null, resultExpiresAt: row.result_expires_at?.toISOString() ?? null, contestComment: row.contest_comment, quote };
};

type Landlord = { id: string; email: string };

/** The landlord asks. Returns the token ONCE (only its hash is kept): the landlord hands the link to the applicant. Only the check types the landlord's row allows are accepted. */
export async function requestScreening(landlord: Landlord, input: { tenantName: string; tenantEmail: string; scope: readonly string[]; payer?: Payer }, now: Date, headers?: Headers): Promise<{ id: string; token: string }> {
  const allowed = await allowedFor(landlord.id);
  const types = allowed.filter((t) => input.scope.includes(t.key));
  if (types.length === 0) throw refuse(400, "BAD_REQUEST", "Nothing lawful to check");
  const scope = types.map((t) => t.key);
  const payer = input.payer ?? PAYER.owner;
  if (!payerAllowed(payer, types)) throw refuse(400, "PAYER_NOT_ALLOWED", "The applicant cannot be asked to pay this check");
  const providers = await Promise.all(types.map((t) => providerById(t.provider_id)));
  // One fictitious type makes the whole request say so.
  const provider = providers.some((p) => p?.adapter === "demo") ? DEMO_PROVIDER : types[0]!.provider_id;
  const token = newToken();
  const [row] = await query<{ id: string }>(
    "INSERT INTO screenings (landlord_id, tenant_name, tenant_email, scope, provider, token_hash, expires_at, payer) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    [landlord.id, input.tenantName.trim(), input.tenantEmail.trim().toLowerCase(), scope, provider, hash(token), addDays(now, REQUEST_VALID_DAYS), payer],
  );
  await audit({ action: "screening.requested", actorId: landlord.id, actorLabel: landlord.email, targetId: row!.id, detail: { scope, provider, payer }, headers });
  return { id: row!.id, token };
}

export async function listForLandlord(landlordId: string, now: Date): Promise<LandlordView[]> {
  await purgeExpired(now);
  const rows = await query<Row>("SELECT * FROM screenings WHERE landlord_id = $1 AND flow = 'screening' ORDER BY created_at DESC LIMIT 100", [landlordId]);
  return rows.map((r) => landlordView(r, now));
}

export async function byToken(token: string): Promise<Row> {
  const [row] = await query<Row>("SELECT s.*, a.email AS landlord_email FROM screenings s JOIN accounts a ON a.id = s.landlord_id WHERE s.token_hash = $1", [hash(token)]);
  if (!row) throw refuse(404, "NOT_FOUND", "No such request");
  return row;
}

export async function viewForTenant(token: string, now: Date): Promise<TenantView> {
  await purgeExpired(now);
  return viewOf(await screeningRow(token), now);
}

/** The answer to a screening request by its token: an applicant file (yomizaka#127) has its own routes, never this one. */
const screeningRow = async (token: string): Promise<Row> => {
  const row = await byToken(token);
  if (row.flow !== "screening") throw refuse(404, "NOT_FOUND", "No such request");
  return row;
};

/** The tenant's view with the price of each check and who pays, read from the rows. */
async function viewOf(row: Row, now: Date): Promise<TenantView> {
  const lines = quoteOf(await typesByKey(row.scope));
  const days = resultDays(await policyFor(row.landlord_id, SUBJECT.screeningResult));
  return tenantView(row, now, { lines, totalCents: totalCents(lines), payer: row.payer ?? PAYER.owner }, days);
}

const actor = (row: Row) => ({ actorId: null, actorLabel: `tenant:${row.tenant_email}` });

interface Answer {
  type: CheckTypeRow;
  runId: string;
  result: CheckResult;
  item: z.infer<typeof screeningItem>;
  /** When a pending answer is asked again. */
  pollMinutes: number;
}
/** Asks each check type's provider (chosen by its row's adapter). A provider that fails is a line « unavailable », never an invented result. */
async function runChecks(row: Row, types: readonly CheckTypeRow[]): Promise<Answer[]> {
  const adapters = new Map<string, { provider: CheckProvider; pollMinutes: number }>();
  const answers: Answer[] = [];
  for (const type of types) {
    let entry = adapters.get(type.provider_id);
    if (!entry) {
      const providerRow = await providerById(type.provider_id);
      if (!providerRow?.enabled) throw refuse(503, "PROVIDER_UNAVAILABLE", "No such screening provider");
      entry = { provider: adapterFor(providerRow.adapter), pollMinutes: providerRow.poll_minutes };
      adapters.set(type.provider_id, entry);
    }
    const runId = crypto.randomUUID();
    const call = { userId: row.landlord_id, runId, subject: { subjectId: row.id, ...namesOf(row.tenant_name) }, region: type.region };
    let result: CheckResult;
    try {
      result = await entry.provider.submit(type.purpose, call);
    } catch {
      result = { outcome: "PROVIDER_ERROR", refusal: null, category: "NONE", providerRef: null };
    }
    answers.push({ type, runId, result, item: itemOf(type.key, result), pollMinutes: entry.pollMinutes });
  }
  return answers;
}
/** One row per check: its closed outcome, the provider's opaque reference and the run id. Never a raw report, never a name. */
async function recordChecks(screeningId: string, answers: readonly Answer[], now: Date): Promise<void> {
  for (const a of answers) {
    await query(
      "INSERT INTO screening_checks (screening_id, check_type, state, outcome, refusal, category, provider_ref, run_id, submitted_at, answered_at, next_poll_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (screening_id, check_type) DO NOTHING",
      [screeningId, a.type.key, stateOf(a.result), a.result.outcome, a.result.refusal, a.result.category, a.result.providerRef, a.runId, now, stateOf(a.result) === CHECK_STATE.answered ? now : null, stateOf(a.result) === CHECK_STATE.pending ? addMinutes(now, a.pollMinutes) : null],
    );
  }
}

/** Per-check billing: only when the flag is on, and only a check the provider accepted (answered or pending). Never blocks the check. */
async function billAnswers(row: Row, answers: readonly Answer[]): Promise<void> {
  const port = await screeningBillingPort();
  if (!port) return;
  const [account] = await query<{ locale: "en" | "fr" }>("SELECT locale FROM accounts WHERE id = $1", [row.landlord_id]);
  const template = getDictionary(account?.locale ?? "fr").screening.invoice.line;
  for (const a of answers) {
    if (!isChargeable(stateOf(a.result), priceCents(a.type))) continue;
    const label = { fr: a.type.label_fr, en: a.type.label_en }[account?.locale ?? "fr"];
    await chargeCheck(port, { screeningId: row.id, type: a.type, payer: row.payer ?? PAYER.owner, description: invoiceLine(template, label) });
  }
}

/** The tenant consents: the provider is called, a minimal result is kept for the retention window, and the tenant sees it first. */
export async function consent(token: string, now: Date, headers?: Headers): Promise<TenantView> {
  const row = await screeningRow(token);
  const state = effectiveState(row, now);
  if (state.status !== SCREENING_STATUS.requested) throw refuse(409, "NOT_PENDING", "This request is no longer waiting for an answer");
  const types = await typesByKey(row.scope);
  const purposes = purposesOfTypes(types);
  // The consent per purpose is recorded first (notice version, date, means); the check then runs only while each stands (yomizaka#131).
  for (const purpose of purposes) await grantConsent(row.id, purpose, { noticeVersion: NOTICE_VERSION, means: CONSENT_MEANS.WEB_FORM }, now, headers);
  for (const purpose of purposes) await requireConsent(row.id, purpose);
  const answers = await runChecks(row, types);
  const result: ScreeningResult = { band: bandOf(answers.map((a) => a.item)), items: answers.map((a) => a.item), provider: row.provider, generatedAt: now.toISOString() };
  const [updated] = await query<Row>(
    "UPDATE screenings SET status = 'consented', consented_at = $2, result = $3, result_expires_at = $4 WHERE id = $1 AND status = 'requested' RETURNING *",
    [row.id, now, JSON.stringify(result), addDays(now, resultDays(await policyFor(row.landlord_id, SUBJECT.screeningResult)))],
  );
  if (!updated) throw refuse(409, "NOT_PENDING", "This request is no longer waiting for an answer");
  await recordChecks(row.id, answers, now);
  await billAnswers(row, answers);
  await audit({ ...actor(row), action: "screening.consented", targetId: row.id, detail: { scope: row.scope, provider: row.provider, payer: row.payer ?? PAYER.owner, quote: quoteOf(types) }, headers });
  return viewOf({ ...updated, landlord_email: row.landlord_email }, now);
}

/** « 2026-10-27 », the day in UTC. */
const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);

/** The applicant's copy of their result (Loi 25: access): what was asked, when, what each check said, how long it is kept. Plain text, no score. Audited. */
export async function copyForTenant(token: string, labels: Readonly<Record<string, string>>, say: Readonly<{ outcome: Record<string, string>; band: Record<string, string>; keptUntil: string; title: string }>, now: Date, headers?: Headers): Promise<{ fileName: string; text: string }> {
  const row = await screeningRow(token);
  const state = effectiveState(row, now);
  const result = state.resultAlive ? parseResult(row.result) : null;
  if (!result) throw refuse(404, "NOT_FOUND", "There is no result to copy");
  const lines = [say.title, `${isoDay(row.created_at)} — ${row.landlord_email ?? ""}`, "", `${say.band[result.band]}`, ...result.items.map((i) => `- ${labels[i.key] ?? i.key}: ${say.outcome[i.outcome] ?? i.outcome}`)];
  if (row.result_expires_at) lines.push("", say.keptUntil.replace("{date}", isoDay(row.result_expires_at)));
  await audit({ ...actor(row), action: "screening.copy", targetId: row.id, headers });
  return { fileName: `result-${row.id.slice(0, 8)}.txt`, text: `${lines.join("\n")}\n` };
}

export async function decline(token: string, now: Date, headers?: Headers): Promise<TenantView> {
  const row = await screeningRow(token);
  if (effectiveState(row, now).status !== SCREENING_STATUS.requested) throw refuse(409, "NOT_PENDING", "This request is no longer waiting for an answer");
  const [updated] = await query<Row>("UPDATE screenings SET status = 'declined' WHERE id = $1 AND status = 'requested' RETURNING *", [row.id]);
  await audit({ ...actor(row), action: "screening.declined", targetId: row.id, headers });
  return viewOf({ ...updated!, landlord_email: row.landlord_email }, now);
}

/** The tenant releases their result to the landlord. */
export async function share(token: string, now: Date, headers?: Headers): Promise<TenantView> {
  const row = await screeningRow(token);
  const state = effectiveState(row, now);
  if (state.status !== SCREENING_STATUS.consented || !state.resultAlive) throw refuse(409, "NOT_SHAREABLE", "There is no result to share");
  const [updated] = await query<Row>("UPDATE screenings SET status = 'shared', shared_at = $2 WHERE id = $1 AND status = 'consented' RETURNING *", [row.id, now]);
  await audit({ ...actor(row), action: "screening.shared", targetId: row.id, headers });
  return viewOf({ ...updated!, landlord_email: row.landlord_email }, now);
}

/** The tenant contests the result: the landlord never sees it, only « contested ». */
export async function contest(token: string, comment: string, now: Date, headers?: Headers): Promise<TenantView> {
  const row = await screeningRow(token);
  const state = effectiveState(row, now);
  if ((state.status !== SCREENING_STATUS.consented && state.status !== SCREENING_STATUS.shared) || !state.resultAlive) throw refuse(409, "NOT_CONTESTABLE", "There is no result to contest");
  const [updated] = await query<Row>("UPDATE screenings SET status = 'contested', contested_at = $2, contest_comment = $3 WHERE id = $1 AND status IN ('consented', 'shared') RETURNING *", [row.id, now, comment.trim().slice(0, 500)]);
  await audit({ ...actor(row), action: "screening.contested", targetId: row.id, headers });
  return viewOf({ ...updated!, landlord_email: row.landlord_email }, now);
}

/** Retention: results past their window are deleted (the summary goes, the fact of the request stays), and unanswered requests expire. */
export async function purgeExpired(now: Date): Promise<number> {
  const purged = await query<{ id: string }>("UPDATE screenings SET result = NULL, purged_at = $1, contest_comment = NULL WHERE result IS NOT NULL AND result_expires_at <= $1 RETURNING id", [now]);
  await query("UPDATE screenings SET status = 'expired' WHERE status = 'requested' AND expires_at <= $1", [now]);
  // What the checks kept (their outcomes, references and run ids) goes with the summary: the fact of the request stays, nothing else.
  if (purged.length) await query("DELETE FROM screening_checks WHERE screening_id = ANY($1)", [purged.map((p) => p.id)]);
  for (const p of purged) await audit({ action: "screening.purged", actorId: null, actorLabel: "retention", targetId: p.id });
  return purged.length;
}
