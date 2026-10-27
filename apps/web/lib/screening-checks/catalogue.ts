import { query } from "../db";
import type { CheckPurpose } from "./model";

/**
 * The provider rows, the check types and what each owner may request — all data (yomizaka#132). A check type or a provider is
 * switched by a row, no deploy. Multi-tenant: `tenant_check_setting` is per owner (the account that asks for checks).
 */
export interface ProviderRow {
  id: string;
  adapter: string;
  label: string;
  region: string;
  enabled: boolean;
  note: string | null;
  /** A pending answer is asked again after this many minutes, at most `poll_max` times (data, yomizaka#134). */
  poll_minutes: number;
  poll_max: number;
}
export interface CheckTypeRow {
  key: string;
  provider_id: string;
  purpose: CheckPurpose;
  label_fr: string;
  label_en: string;
  /** What the provider charges Krizaka, and Krizaka's margin: both price data, in cents (CAD). The charge is their sum (yomizaka#133). */
  provider_cost_cents: number;
  margin_cents: number;
  currency: string;
  /** The subject's region the engine routes by (court records in Québec go to a different vendor). */
  region: string;
  consent_notice_version: string;
  enabled: boolean;
  /** Offered to an owner with no row of their own. */
  default_on: boolean;
  /** Set on a type that stays off until a lawyer confirms it is lawful (the compliance gate, yomizaka#135). */
  requires_lawyer: string | null;
  note: string | null;
}
export interface SettingRow {
  owner_id: string;
  check_type: string;
  allowed: boolean;
}

/** Pure: the types an owner may request. An owner's own row wins; without one the type's default applies; a disabled type is never offered. */
export function allowedTypes(types: readonly CheckTypeRow[], settings: readonly SettingRow[], providers: readonly ProviderRow[]): CheckTypeRow[] {
  const own = new Map(settings.map((s) => [s.check_type, s.allowed]));
  const live = new Set(providers.filter((p) => p.enabled).map((p) => p.id));
  return types.filter((t) => t.enabled && live.has(t.provider_id) && (own.get(t.key) ?? t.default_on));
}

/** Pure: the charge of a check — the provider's cost plus the margin, both from the row. */
export const priceCents = (t: Pick<CheckTypeRow, "provider_cost_cents" | "margin_cents">): number => t.provider_cost_cents + t.margin_cents;

export const loadProviders = () => query<ProviderRow>("SELECT id, adapter, label, region, enabled, note, poll_minutes, poll_max FROM screening_provider ORDER BY id");
export const loadCheckTypes = () => query<CheckTypeRow>("SELECT * FROM check_type ORDER BY key");

/** The types this owner may request now. */
export async function allowedFor(ownerId: string): Promise<CheckTypeRow[]> {
  const [types, providers, settings] = await Promise.all([loadCheckTypes(), loadProviders(), query<SettingRow>("SELECT owner_id, check_type, allowed FROM tenant_check_setting WHERE owner_id = $1", [ownerId])]);
  return allowedTypes(types, settings, providers);
}

/** The rows of the keys asked (any state), to read their purpose, provider and notice version. */
export async function typesByKey(keys: readonly string[]): Promise<CheckTypeRow[]> {
  if (keys.length === 0) return [];
  return query<CheckTypeRow>("SELECT * FROM check_type WHERE key = ANY($1)", [keys]);
}
export async function providerById(id: string): Promise<ProviderRow | undefined> {
  return (await query<ProviderRow>("SELECT id, adapter, label, region, enabled, note, poll_minutes, poll_max FROM screening_provider WHERE id = $1", [id]))[0];
}

/** The labels of every check type in one language (data): the pages name a check by its row, never by a message key typed in code. */
export async function labelsIn(locale: "en" | "fr"): Promise<Record<string, string>> {
  return Object.fromEntries((await loadCheckTypes()).map((t) => [t.key, { fr: t.label_fr, en: t.label_en }[locale]]));
}
