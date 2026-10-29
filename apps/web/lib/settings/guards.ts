import { refuse } from "../http";
import { type Maintenance, maintenanceOf, type Snapshot } from "./boundary";
import { appSettings } from "./instance";
import type { SettingKey } from "./registry";

/** The features that can be switched off: the server refuses what is off, whatever the browser shows. */
export const FEATURE = {
  documentInsight: "features.documentInsight",
  personalInfo: "features.personalInfo",
  keepDocuments: "features.keepDocuments",
  ownStorage: "features.ownStorage",
  assistant: "features.assistant",
  apiKeys: "features.apiKeys",
  collectionAvatars: "features.collectionAvatars",
  batches: "features.batches",
  webhooks: "features.webhooks",
} as const satisfies Record<string, SettingKey>;
export type Feature = keyof typeof FEATURE;

/** Every setting as it applies to this person (their own overrides, their workspace's, the global ones). */
export const settingsFor = (userId: string | null): Promise<Snapshot> => appSettings().snapshot({ userId });

export const featureOn = async (feature: Feature, userId: string | null): Promise<boolean> => (await appSettings().get(FEATURE[feature], { userId })) as boolean;

/** 403 FEATURE_OFF when the feature is switched off for this person. */
export async function assertFeature(feature: Feature, userId: string | null): Promise<void> {
  if (!(await featureOn(feature, userId))) throw refuse(403, "FEATURE_OFF", "This feature is switched off", { feature });
}

/** 403 FEATURE_OFF when the administrator has not opened user cloud connections (`storage.userConnectors`, off by default: a new data flow is opened on purpose). */
export async function assertUserConnectors(): Promise<void> {
  if ((await appSettings().get("storage.userConnectors" as SettingKey)) !== true) throw refuse(403, "FEATURE_OFF", "Connecting a cloud is switched off", { feature: "storage.userConnectors" });
}

/** The two feature switches the document view depends on, resolved for this person. */
export async function insightFeatures(userId: string | null): Promise<{ documentInsight: boolean; personalInfo: boolean }> {
  const [documentInsight, personalInfo] = await Promise.all([featureOn("documentInsight", userId), featureOn("personalInfo", userId)]);
  return { documentInsight, personalInfo };
}

export async function maintenance(): Promise<Maintenance> {
  return maintenanceOf(await appSettings().snapshot());
}

const ADMIN = "ADMIN";

/** 503 MAINTENANCE while the app is closed for consumers (an administrator is never locked out). */
export async function assertOpen(account: { role: "USER" | "ADMIN" }): Promise<void> {
  if (account.role === ADMIN) return;
  const m = await maintenance();
  if (m.on) throw refuse(503, "MAINTENANCE", "The app is in maintenance", { message: m.message });
}
