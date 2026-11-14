import { type Layers, type Resolved, resolveValue as resolveDef } from "@krizaka/settings";

import { defOf, type SettingKey } from "./registry";

export type { Layers, Resolved };

/** The effective value: user, then workspace, then global, then the default (the package's rule, over this product's registry). */
export const resolveSetting = (key: SettingKey, layers: Layers, fallback?: unknown): Resolved =>
  resolveDef(defOf(key), layers, fallback);
