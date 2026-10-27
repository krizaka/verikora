import { authSettings } from "@krizaka/auth/settings";
import { creditsSettings } from "@krizaka/credits/settings";
import { ALL_SCOPES, bilingual, choice, defineSettings, flag, integer, type Registry, SCOPE, subset, WORKSPACE_SCOPES } from "@krizaka/settings";
import type { z } from "zod";

import { LIMIT_SETTINGS } from "./limits";

/**
 * Every setting of the app: its key, its type, its default and the scopes it can be overridden at. Settings are DATA in the
 * database (ADR-0009), changed by an administrator without a redeploy; the registry is the one place that says what exists,
 * so the admin forms, the validation and the checks at the server boundary all read the same list.
 */
export { SCOPE };
export { type Scope, SCOPES_BY_SPECIFICITY } from "@krizaka/settings";

export const GROUP = { general: "general", features: "features", limits: "limits", plans: "plans" } as const;
export type Group = (typeof GROUP)[keyof typeof GROUP];
export const GROUPS = Object.values(GROUP);

export { type Def, KIND, type Kind } from "@krizaka/settings";

const ALL = ALL_SCOPES;
const WORKSPACE = WORKSPACE_SCOPES;

export const PAYMENT_DISPLAY = { test: "test", live: "live" } as const;
export const AVATAR_SEED_CHOICES = ["v1", "v2", "v3", "v4", "v5", "v6"] as const;
export const FILE_TYPES = ["pdf", "text", "image", "word"] as const;

/** The platform's cap on a file: a limit here can only go down from it. */
// @fixed: what the pre-flight and the uploads can carry
export const PLATFORM_MAX_FILE_MB = 10;

/** A package fragment, filed under one of the console's groups (the package names its own; the console's tabs are this product's). */
function inGroup<F extends Registry>(group: Group, fragment: F): F {
  return Object.fromEntries(Object.entries(fragment).map(([key, def]) => [key, { ...def, group }])) as F;
}

export const SETTINGS = {
  // General: the switches that open and close the app for consumers.
  "app.maintenance": flag(GROUP.general, false),
  "app.maintenanceMessage": bilingual(GROUP.general, { fr: "Yomizaka est en maintenance. Revenez dans quelques minutes.", en: "Yomizaka is down for maintenance. Please come back in a few minutes." }),
  "signup.open": flag(GROUP.general, false),
  // How long a session lasts (`auth.sessionDays`) and how long a « Forgot your password? » link works (`auth.passwordResetMinutes`): @krizaka/auth's.
  ...inGroup(GROUP.general, authSettings),
  "payments.enabled": flag(GROUP.general, true, WORKSPACE),
  "payments.display": choice(GROUP.general, [PAYMENT_DISPLAY.test, PAYMENT_DISPLAY.live], PAYMENT_DISPLAY.test),
  "audit.freeFirst": flag(GROUP.general, true, WORKSPACE),
  /** How long the free first audit, once given, can be used (yomizaka#261: it is a pot of the credits ledger, and a pot lapses). */
  "audit.freeValidDays": integer(GROUP.general, 3650, { min: 1, max: 36500, unit: "days" }),
  // The credits ledger's knobs (the zone days and months are counted in, how long a hold keeps credits back): @krizaka/credits'.
  ...inGroup(GROUP.general, creditsSettings),
  // Features: each can be switched off for everyone, a workspace or one person (a beta).
  "features.documentInsight": flag(GROUP.features, true, ALL),
  "features.personalInfo": flag(GROUP.features, true, WORKSPACE),
  "features.keepDocuments": flag(GROUP.features, true, ALL),
  "features.ownStorage": flag(GROUP.features, true, WORKSPACE),
  "features.assistant": flag(GROUP.features, false, ALL),
  // API keys (ADR-0011): the global switch; what a plan holds is below.
  "features.apiKeys": flag(GROUP.features, true, WORKSPACE),
  // Collection avatars (krizaka/yomizaka#206): on or off, which of the set are offered, how heavy an uploaded image may be.
  "features.collectionAvatars": flag(GROUP.features, true, WORKSPACE),
  /** A batch of checks from a CSV and its files (yomizaka#232). */
  "features.batches": flag(GROUP.features, true, WORKSPACE),
  /** Signed webhooks when a batch or a check finishes (yomizaka#241): the global switch; what a plan holds is below. */
  "features.webhooks": flag(GROUP.features, true, WORKSPACE),
  "features.avatarSet": subset(GROUP.features, AVATAR_SEED_CHOICES, [...AVATAR_SEED_CHOICES]),
  // Limits: what one document and one account may do.
  "limits.maxFileMb": integer(GROUP.limits, PLATFORM_MAX_FILE_MB, { min: 1, max: PLATFORM_MAX_FILE_MB, unit: "MB" }, WORKSPACE),
  "limits.maxPages": integer(GROUP.limits, 200, { min: 1, max: 500, unit: "pages" }, WORKSPACE),
  "limits.allowedTypes": subset(GROUP.limits, FILE_TYPES, [...FILE_TYPES], WORKSPACE),
  "limits.reuseDays": integer(GROUP.limits, 365, { min: 0, max: 3650, unit: "days" }),
  "limits.purgeAfterHours": integer(GROUP.limits, 24, { min: 1, max: 720, unit: "hours" }),
  "limits.apiRequestsPerMinute": integer(GROUP.limits, 60, { min: 1, max: 6000, unit: "requests" }, WORKSPACE),
  "limits.batchMaxRows": integer(GROUP.limits, 200, { min: 1, max: 1000, unit: "rows" }, WORKSPACE),
  "limits.batchConcurrency": integer(GROUP.limits, 2, { min: 1, max: 10, unit: "checks" }),
  /** A batch advances by itself (yomizaka#240): how often the server looks (0 = never, the batch then advances only when read), how old a batch may be, how many it takes per look. */
  "limits.batchTickSeconds": integer(GROUP.limits, 20, { min: 0, max: 3600, unit: "seconds" }),
  "limits.batchTickMaxAgeHours": integer(GROUP.limits, 48, { min: 1, max: 720, unit: "hours" }),
  "limits.batchTickBatches": integer(GROUP.limits, 10, { min: 1, max: 100, unit: "batches" }),
  /** Tries before a webhook delivery is given up (the first included); the waits grow from 30 s to 12 h. */
  "limits.webhookMaxAttempts": integer(GROUP.limits, 6, { min: 1, max: 12, unit: "tries" }),
  /** The heaviest ZIP of a batch's reports the server will build (yomizaka#242). */
  "limits.batchExportMaxMb": integer(GROUP.limits, 50, { min: 1, max: 200, unit: "MB" }),
  "limits.avatarMaxKb": integer(GROUP.limits, 512, { min: 16, max: 2048, unit: "KB" }),
  "limits.bonusAuditsPerMonth": integer(GROUP.limits, 0, { min: 0, max: 10000, unit: "audits" }, [SCOPE.user]),
  // What an action may do in a window (yomizaka#260): `limits.<action>.perIp|perSubject|windowSeconds`, from `@krizaka/rate-limit`.
  ...LIMIT_SETTINGS,
  // Plans: what each plan allows beside its price. The prices and the verifications a subscription includes are the price
  // catalogue's (ADR-009, `lib/pricing.ts`, admin `/config/prices`); « pro » is any subscription (Agencies or Law firms).
  "plans.free.auditsPerDay": integer(GROUP.plans, 0, { min: 0, max: 1000, unit: "audits" }, WORKSPACE),
  "plans.free.apiKeys": integer(GROUP.plans, 0, { min: 0, max: 100, unit: "keys" }, WORKSPACE),
  "plans.pro.apiKeys": integer(GROUP.plans, 10, { min: 0, max: 100, unit: "keys" }, WORKSPACE),
  "plans.free.webhookEndpoints": integer(GROUP.plans, 0, { min: 0, max: 100, unit: "endpoints" }, WORKSPACE),
  "plans.pro.webhookEndpoints": integer(GROUP.plans, 3, { min: 0, max: 100, unit: "endpoints" }, WORKSPACE),
  "plans.pro.auditsPerDay": integer(GROUP.plans, 0, { min: 0, max: 5000, unit: "audits" }, WORKSPACE),
} as const satisfies Registry;

const settings = defineSettings(SETTINGS);
/** The registry's tools (the shared package's), over this product's own list. */
export { settings };
export type SettingKey = keyof typeof SETTINGS;
export type ValueOf<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;
export const SETTING_KEYS = settings.keys;
export const isSettingKey = settings.isKey;
export const defOf = settings.defOf;
export const keysOfGroup = settings.keysOfGroup;
