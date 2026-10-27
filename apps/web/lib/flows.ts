import { type Audience, AUDIENCE_STATUS, AUDIENCES, FLOW_STATUS, type FlowDefinition, flowDefinition, type FlowEnvironment, type FlowVersionStatus, offerOf, STEP_KIND, type Studio, VERSION_STATUS } from "@yomizaka/core";

import { audit } from "./audit";
import { purposeOfKey } from "./consent-purpose";
import { query, withBlockingLock } from "./db";
import { SEED_FLOWS } from "./flows-seed";
import { refuse } from "./http";
import { logError } from "./log";
import { accountSubject, consentsFor } from "./privacy";

/**
 * Flows are data (ADR-0003): defined and administered in the database by the platform administrator, read by the app. This
 * module is the only door: the reads of the app (`availableFlows`, `audiencesOf`, `offerFor`, `resolveStart`) and the
 * administration (`createFlow`, `saveDraft`, `publish`, `setEnvironment`).
 */
export interface AvailableFlow {
  key: string;
  versionId: string | null;
  version: number;
  definition: FlowDefinition;
}

interface VersionRow {
  key: string;
  version_id: string;
  version: number;
  definition: unknown;
}

const parse = (definition: unknown): FlowDefinition | null => {
  const parsed = flowDefinition.safeParse(definition);
  return parsed.success ? parsed.data : null;
};

/** The seeded definitions enabled in an environment — what the public pages use when the database cannot be reached. */
export const seedFlows = (environment: FlowEnvironment): AvailableFlow[] => SEED_FLOWS.filter((f) => f.environments.includes(environment)).map((f) => ({ key: f.key, versionId: null, version: 1, definition: f.definition }));

/**
 * The flows available in an environment: the current published version of every flow enabled there. A disabled flow is not
 * here, whatever else says so. Without a reachable database (a build, an outage) the public pages fall back to the seeds.
 */
export async function availableFlows(environment: FlowEnvironment, options: { fallback?: boolean } = { fallback: true }): Promise<AvailableFlow[]> {
  try {
    const rows = await query<VersionRow>(
      `SELECT f.key, v.id AS version_id, v.version, v.definition
         FROM flows f
         JOIN flow_versions v ON v.id = f.current_version_id AND v.status = 'published'
         JOIN flow_environments e ON e.flow_id = f.id AND e.environment = $1 AND e.enabled
        ORDER BY f.key`,
      [environment],
    );
    return rows.flatMap((r) => {
      const definition = parse(r.definition);
      return definition ? [{ key: r.key, versionId: r.version_id, version: r.version, definition }] : [];
    });
  } catch (error) {
    if (!options.fallback) throw error;
    logError("flows: the database could not be read, using the seeded definitions", error);
    return seedFlows(environment);
  }
}

/** The audiences offered by the flows, in the vocabulary's order: `available` when any of its flows runs today, else `soon`. */
export function audiencesOf(flows: readonly AvailableFlow[]): { audience: Audience; status: "available" | "soon" }[] {
  return AUDIENCES.flatMap((audience) => {
    const mine = flows.filter((f) => f.definition.audiences.includes(audience));
    if (mine.length === 0) return [];
    return [{ audience, status: mine.some((f) => f.definition.status === FLOW_STATUS.available) ? ("available" as const) : ("soon" as const) }];
  });
}

/** What a person is offered on a document: the flows of their audience (all of them until they chose a side). */
export const flowsFor = (flows: readonly AvailableFlow[], audience: Audience | null): AvailableFlow[] => (audience ? flows.filter((f) => f.definition.audiences.includes(audience)) : [...flows]);

/** The flow that carries the applicant files (yomizaka#127: a screening row of flow « file »). */
export const APPLICANT_FILE_FLOW = "tenant-screening";

/** Whether « Dossiers » is offered: the applicant-file flow is enabled and offered to this person's audience (yomizaka#319). */
export const applicantFilesOffered = (flows: readonly AvailableFlow[], audience: Audience | null): boolean => flowsFor(flows, audience).some((f) => f.key === APPLICANT_FILE_FLOW);

export const offerFor = (flows: readonly AvailableFlow[], audience: Audience | null) => offerOf(flowsFor(flows, audience).map((f) => f.definition));

/** Without any enabled flow the status words fall back to the vocabulary's own (`AUDIENCE_STATUS`) — used only by tests of the fallback. */
export const vocabularyStatus = AUDIENCE_STATUS;

/* ---- consents ---- */

/** The purposes the person has consented to (the last word of each one is a yes): for a conforming key, the key itself (`purposeOfKey`). */
export async function grantedConsents(accountId: string): Promise<string[]> {
  const last = new Map<string, boolean>();
  for (const c of await consentsFor([]).consentHistory(query, accountSubject(accountId))) last.set(c.purpose, c.granted);
  return [...last].filter(([, granted]) => granted).map(([purpose]) => purpose);
}

/** Records the consent of a flow (its notice version is the flow's, the proof of what was agreed to); a person who already consented is left as they are. */
export async function grantConsent(account: { id: string; email: string }, key: string, headers?: Headers, noticeVersion = "flow"): Promise<void> {
  const purpose = purposeOfKey(key);
  const privacy = consentsFor([purpose]);
  const subject = accountSubject(account.id);
  if (await privacy.hasConsent(query, subject, purpose)) return;
  await privacy.recordConsent(query, { subject, purpose, version: noticeVersion, granted: true, means: "checkbox" });
  await audit({ action: "consent.granted", actorId: account.id, actorLabel: account.email, targetId: account.id, detail: { key }, headers });
}

export async function revokeConsent(account: { id: string; email: string }, key: string, headers?: Headers): Promise<void> {
  const purpose = purposeOfKey(key);
  const privacy = consentsFor([purpose]);
  const subject = accountSubject(account.id);
  if (!(await privacy.hasConsent(query, subject, purpose))) return;
  await privacy.recordConsent(query, { subject, purpose, version: "withdrawal", granted: false, means: "settings" });
  await audit({ action: "consent.revoked", actorId: account.id, actorLabel: account.email, targetId: account.id, detail: { key }, headers });
}

/**
 * Pure: may this person start a Studio now? The flow must be enabled and offered to them, and every consent it requires must
 * be granted. Returns the flow to run under, or the refusal (the route turns it into a 403 with a stable code).
 */
/** A dated ruleset (`qc-residential-lease/2026-10-24`) runs under the flow that names its ruleset (`qc-residential-lease`). */
export const rulesetId = (ruleset: string): string => ruleset.split("/")[0] ?? ruleset;

export function decideStart(flows: readonly AvailableFlow[], audience: Audience | null, studio: Studio, granted: readonly string[], ruleset?: string): { ok: true; flow: AvailableFlow } | { ok: false; code: "FLOW_NOT_OFFERED" | "CONSENT_REQUIRED"; missing: string[] } {
  // A named ruleset (the invoice) is run only under a flow whose step carries it — never because the request asked.
  const candidates = flowsFor(flows, audience).filter((f) =>
    f.definition.steps.some((s) => s.kind === STEP_KIND.studio && s.studio === studio && (!ruleset || s.jurisdictions.some((j) => j.ruleset === rulesetId(ruleset)))),
  );
  if (candidates.length === 0) return { ok: false, code: "FLOW_NOT_OFFERED", missing: [] };
  // The first flow whose consents the person has given; else the first flow's missing consents are reported.
  const runnable = candidates.find((f) => f.definition.consents.every((c) => granted.includes(purposeOfKey(c))));
  if (runnable) return { ok: true, flow: runnable };
  return { ok: false, code: "CONSENT_REQUIRED", missing: candidates[0]!.definition.consents.filter((c) => !granted.includes(purposeOfKey(c))) };
}

/** Enforced server-side before any run starts (never only hidden in the UI): the flow's version id is kept with the analysis. */
export async function resolveStart(account: { id: string; perspective: Audience | null }, studio: Studio, environment: FlowEnvironment, ruleset?: string): Promise<{ flowVersionId: string | null }> {
  const flows = await availableFlows(environment, { fallback: false });
  const decision = decideStart(flows, account.perspective, studio, await grantedConsents(account.id), ruleset);
  if (!decision.ok) throw refuse(403, decision.code, decision.code === "CONSENT_REQUIRED" ? "A consent this flow requires has not been given" : "This check is not offered", { missing: decision.missing });
  return { flowVersionId: decision.flow.versionId };
}

/* ---- the administration ---- */

export interface AdminFlow {
  id: string;
  key: string;
  currentVersion: number | null;
  title: string;
  status: "available" | "soon" | null;
  audiences: string[];
  environments: Record<FlowEnvironment, boolean>;
  versions: { id: string; version: number; status: FlowVersionStatus; publishedAt: string | null; definition: FlowDefinition | null }[];
}

export async function listAdminFlows(): Promise<AdminFlow[]> {
  const flows = await query<{ id: string; key: string; current_version_id: string | null }>("SELECT id, key, current_version_id FROM flows ORDER BY key");
  const versions = await query<{ id: string; flow_id: string; version: number; status: FlowVersionStatus; published_at: Date | null; definition: unknown }>("SELECT id, flow_id, version, status, published_at, definition FROM flow_versions ORDER BY version DESC");
  const envs = await query<{ flow_id: string; environment: FlowEnvironment; enabled: boolean }>("SELECT flow_id, environment, enabled FROM flow_environments");
  return flows.map((f) => {
    const mine = versions.filter((v) => v.flow_id === f.id).map((v) => ({ id: v.id, version: v.version, status: v.status, publishedAt: v.published_at?.toISOString() ?? null, definition: parse(v.definition) }));
    const current = mine.find((v) => v.id === f.current_version_id) ?? null;
    const shown = current?.definition ?? mine[0]?.definition ?? null;
    return {
      id: f.id,
      key: f.key,
      currentVersion: current?.version ?? null,
      title: shown?.title.en ?? f.key,
      status: shown?.status ?? null,
      audiences: shown?.audiences ?? [],
      environments: { dev: envs.some((e) => e.flow_id === f.id && e.environment === "dev" && e.enabled), prod: envs.some((e) => e.flow_id === f.id && e.environment === "prod" && e.enabled) },
      versions: mine,
    };
  });
}

type Actor = { id: string; email: string };

export async function createFlow(actor: Actor, key: string, definition: FlowDefinition, headers?: Headers): Promise<{ id: string; versionId: string }> {
  const [exists] = await query("SELECT id FROM flows WHERE key = $1", [key]);
  if (exists) throw refuse(409, "FLOW_EXISTS", "A flow with this key exists");
  const [flow] = await query<{ id: string }>("INSERT INTO flows (key) VALUES ($1) RETURNING id", [key]);
  const [version] = await query<{ id: string }>("INSERT INTO flow_versions (flow_id, version, status, definition, created_by) VALUES ($1, 1, 'draft', $2, $3) RETURNING id", [flow!.id, JSON.stringify(definition), actor.id]);
  await audit({ action: "flow.created", actorId: actor.id, actorLabel: actor.email, targetId: flow!.id, detail: { key }, headers });
  return { id: flow!.id, versionId: version!.id };
}

/** Saves the draft: edits the open draft, or opens one (a copy of the next version number) — a published version is never edited. */
export async function saveDraft(actor: Actor, flowId: string, definition: FlowDefinition, headers?: Headers): Promise<{ versionId: string; version: number }> {
  const [draft] = await query<{ id: string; version: number }>("SELECT id, version FROM flow_versions WHERE flow_id = $1 AND status = 'draft' ORDER BY version DESC LIMIT 1", [flowId]);
  if (draft) {
    await query("UPDATE flow_versions SET definition = $2 WHERE id = $1", [draft.id, JSON.stringify(definition)]);
    await audit({ action: "flow.draft_saved", actorId: actor.id, actorLabel: actor.email, targetId: flowId, detail: { version: draft.version }, headers });
    return { versionId: draft.id, version: draft.version };
  }
  const [next] = await query<{ n: number }>("SELECT coalesce(max(version), 0) + 1 AS n FROM flow_versions WHERE flow_id = $1", [flowId]);
  const [created] = await query<{ id: string }>("INSERT INTO flow_versions (flow_id, version, status, definition, created_by) VALUES ($1, $2, 'draft', $3, $4) RETURNING id", [flowId, next!.n, JSON.stringify(definition), actor.id]);
  await audit({ action: "flow.draft_saved", actorId: actor.id, actorLabel: actor.email, targetId: flowId, detail: { version: next!.n }, headers });
  return { versionId: created!.id, version: next!.n };
}

/** Publishes a draft: it becomes immutable and the flow's current version; the previous current one is retired (its analyses keep their id). */
export async function publish(actor: Actor, flowId: string, versionId: string, headers?: Headers): Promise<{ version: number }> {
  const [v] = await query<{ id: string; version: number; status: FlowVersionStatus }>("SELECT id, version, status FROM flow_versions WHERE id = $1 AND flow_id = $2", [versionId, flowId]);
  if (!v) throw refuse(404, "NOT_FOUND", "No such version");
  if (v.status !== VERSION_STATUS.draft) throw refuse(409, "NOT_A_DRAFT", "Only a draft can be published");
  await query("UPDATE flow_versions SET status = 'retired' WHERE flow_id = $1 AND status = 'published'", [flowId]);
  await query("UPDATE flow_versions SET status = 'published', published_at = now() WHERE id = $1", [versionId]);
  await query("UPDATE flows SET current_version_id = $2 WHERE id = $1", [flowId, versionId]);
  await audit({ action: "flow.published", actorId: actor.id, actorLabel: actor.email, targetId: flowId, detail: { version: v.version }, headers });
  return { version: v.version };
}

export async function setEnvironment(actor: Actor, flowId: string, environment: FlowEnvironment, enabled: boolean, headers?: Headers): Promise<void> {
  const [flow] = await query("SELECT id FROM flows WHERE id = $1", [flowId]);
  if (!flow) throw refuse(404, "NOT_FOUND", "No such flow");
  await query("INSERT INTO flow_environments (flow_id, environment, enabled) VALUES ($1, $2, $3) ON CONFLICT (flow_id, environment) DO UPDATE SET enabled = $3", [flowId, environment, enabled]);
  await audit({ action: "flow.environment_set", actorId: actor.id, actorLabel: actor.email, targetId: flowId, detail: { environment, enabled }, headers });
}

/** Seeds the flows that exist today, once: a key already in the database is left alone (the administration owns it from then on). */
export async function seedDatabase(): Promise<string[]> {
  // Two starts (two instances, two test files) seeding at once would both insert the same key: one waits for the other, then finds it done.
  return withBlockingLock("seed:flows", seedOnce);
}

async function seedOnce(): Promise<string[]> {
  const created: string[] = [];
  for (const seed of SEED_FLOWS) {
    const [exists] = await query("SELECT id FROM flows WHERE key = $1", [seed.key]);
    if (exists) continue;
    const [flow] = await query<{ id: string }>("INSERT INTO flows (key) VALUES ($1) RETURNING id", [seed.key]);
    const [version] = await query<{ id: string }>("INSERT INTO flow_versions (flow_id, version, status, definition, published_at) VALUES ($1, 1, 'published', $2, now()) RETURNING id", [flow!.id, JSON.stringify(seed.definition)]);
    await query("UPDATE flows SET current_version_id = $2 WHERE id = $1", [flow!.id, version!.id]);
    for (const environment of ["dev", "prod"] as const) await query("INSERT INTO flow_environments (flow_id, environment, enabled) VALUES ($1, $2, $3)", [flow!.id, environment, seed.environments.includes(environment)]);
    created.push(seed.key);
  }
  return created;
}

/**
 * Pure: may this person use the flow `key` now? It must be enabled and offered to their audience, and every consent it requires
 * must be granted — for a landlord's screening, their undertaking (lawful purpose, no discrimination).
 */
export function decideFlow(flows: readonly AvailableFlow[], audience: Audience | null, key: string, granted: readonly string[]): { ok: true; flow: AvailableFlow } | { ok: false; code: "FLOW_NOT_OFFERED" | "CONSENT_REQUIRED"; missing: string[] } {
  const flow = flowsFor(flows, audience).find((f) => f.key === key);
  if (!flow) return { ok: false, code: "FLOW_NOT_OFFERED", missing: [] };
  const missing = flow.definition.consents.filter((c) => !granted.includes(purposeOfKey(c)));
  return missing.length ? { ok: false, code: "CONSENT_REQUIRED", missing } : { ok: true, flow };
}

export async function resolveFlow(account: { id: string; perspective: Audience | null }, key: string, environment: FlowEnvironment): Promise<AvailableFlow> {
  const flows = await availableFlows(environment, { fallback: false });
  const decision = decideFlow(flows, account.perspective, key, await grantedConsents(account.id));
  if (!decision.ok) throw refuse(403, decision.code, decision.code === "CONSENT_REQUIRED" ? "A consent this flow requires has not been given" : "This flow is not offered", { missing: decision.missing });
  return decision.flow;
}
