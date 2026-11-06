import { type DocumentInsight, MAX_FILE_BYTES } from "@verikora/core";

import type { FileKind, PreflightRules } from "../preflight/port";
import type { SettingKey } from "./registry";
import type { Resolved } from "./resolve";

/** The settings a check at the server boundary reads: a resolved snapshot (see SettingsService.snapshot). */
export type Snapshot = Record<SettingKey, Resolved>;
const value = <T>(s: Snapshot, key: SettingKey) => s[key].value as T;

const MB = 1024 * 1024;
/** The file kinds the pre-flight knows by the names the settings use. */
const KINDS_OF: Record<string, FileKind[]> = {
  pdf: ["pdf"],
  text: ["text"],
  image: ["png", "jpeg", "heic"],
  word: ["docx", "odt"],
};

/** The pre-flight rules as set in the configuration: the product's rules with the limits an administrator changed. */
export function preflightRulesFrom(base: PreflightRules, s: Snapshot): PreflightRules {
  return {
    ...base,
    maxBytes: Math.min(MAX_FILE_BYTES, value<number>(s, "limits.maxFileMb") * MB),
    maxPages: value<number>(s, "limits.maxPages"),
    allowedKinds: value<string[]>(s, "limits.allowedTypes").flatMap((t) => KINDS_OF[t] ?? []),
  };
}

/** The « Ce document » panel and the personal-information counts follow their switches: what is off is not sent to the browser at all. */
export function withFeatures<T extends { insight?: DocumentInsight }>(
  doc: T,
  features: { documentInsight: boolean; personalInfo: boolean },
): T {
  if (!features.documentInsight) {
    return { ...doc, insight: undefined };
  }
  if (!features.personalInfo && doc.insight) {
    return { ...doc, insight: { ...doc.insight, pii: { total: 0, counts: {} } } };
  }
  return doc;
}

export interface Maintenance {
  on: boolean;
  message: { fr: string; en: string };
}
export const maintenanceOf = (s: Snapshot): Maintenance => ({
  on: value<boolean>(s, "app.maintenance"),
  message: value<{ fr: string; en: string }>(s, "app.maintenanceMessage"),
});

/** What the browser may know of the configuration (never a secret, never a switch it does not need). */
export interface ClientConfig {
  maxFileBytes: number;
  allowedTypes: string[];
  features: {
    keepDocuments: boolean;
    ownStorage: boolean;
    documentInsight: boolean;
    assistant: boolean;
    batches: boolean;
  };
  payments: { enabled: boolean; display: string };
  /** Collection avatars: on or off, the heaviest uploaded image, the set offered. */
  avatars: { enabled: boolean; maxBytes: number; seeds: string[] };
}
export const clientConfigOf = (s: Snapshot): ClientConfig => ({
  maxFileBytes: Math.min(MAX_FILE_BYTES, value<number>(s, "limits.maxFileMb") * MB),
  allowedTypes: value<string[]>(s, "limits.allowedTypes"),
  features: {
    keepDocuments: value(s, "features.keepDocuments"),
    ownStorage: value(s, "features.ownStorage"),
    documentInsight: value(s, "features.documentInsight"),
    assistant: value(s, "features.assistant"),
    batches: value(s, "features.batches"),
  },
  payments: { enabled: value(s, "payments.enabled"), display: value(s, "payments.display") },
  avatars: {
    enabled: value(s, "features.collectionAvatars"),
    maxBytes: value<number>(s, "limits.avatarMaxKb") * 1024,
    seeds: value<string[]>(s, "features.avatarSet"),
  },
});

/** The caps an audit is held to: monthly — the verifications the subscription's catalogue entry includes, a person's bonus added — and daily (0 = no cap), for the plan the account is on. */
export interface AuditCaps {
  perMonth: number;
  perDay: number;
  /** The dossiers an account without a plan may verify free each calendar month (0 = none): renewed monthly, no card. */
  freeDossiers: number;
  /** What a dossier beyond `perMonth` costs, in cents before taxes (0: none is billed, the account waits for next month). */
  overageCents: number;
}
export const auditCapsOf = (s: Snapshot, plan: "free" | "pro", included: number, overageCents = 0): AuditCaps => ({
  overageCents,
  perMonth: plan === "pro" ? included + value<number>(s, "limits.bonusAuditsPerMonth") : Number.POSITIVE_INFINITY,
  perDay: value<number>(s, plan === "pro" ? "plans.pro.auditsPerDay" : "plans.free.auditsPerDay"),
  freeDossiers: value<boolean>(s, "audit.freeFirst") ? value<number>(s, "plans.free.dossiersPerMonth") : 0,
});
