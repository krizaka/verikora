import { describeSettings as describe, type SettingDescription as Description } from "@krizaka/settings";

import { type SettingKey, settings } from "./registry";

/** A setting as the administration shows it: JSON-safe (no schema), so it can cross to the browser. */
export type AdminSettingDescription = Description<SettingKey>;

export const describeVerikoraSettings = (): AdminSettingDescription[] => describe(settings);
