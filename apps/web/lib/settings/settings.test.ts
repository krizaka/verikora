import { describe, expect, it } from "vitest";

import { defOf, GROUPS, isSettingKey, keysOfGroup, SCOPE, SETTING_KEYS, type SettingKey, SETTINGS } from "./registry";
import { resolveSetting } from "./resolve";

describe("the registry", () => {
  it.each(SETTING_KEYS)("%s: its default is valid for its own schema and it can be set somewhere", (key) => {
    const def = defOf(key);
    expect(def.schema.safeParse(def.default).success).toBe(true);
    expect(def.scopes.length).toBeGreaterThan(0);
  });

  it("every setting belongs to a known group, and every group has settings", () => {
    for (const key of SETTING_KEYS) expect(GROUPS).toContain(defOf(key).group);
    for (const group of GROUPS) expect(keysOfGroup(group).length).toBeGreaterThan(0);
  });

  it("knows what is a setting", () => {
    expect(isSettingKey("app.maintenance")).toBe(true);
    expect(isSettingKey("app.nothing")).toBe(false);
  });

  it.each([11, 0, 1.5])("a file cannot be allowed to be %s MB: the platform carries 10 at most", (mb) => {
    expect(defOf("limits.maxFileMb").schema.safeParse(mb).success).toBe(false);
  });
});

describe("the effective value is user, then workspace, then global, then the default", () => {
  const key: SettingKey = "features.documentInsight";
  it.each([
    ["nothing set", {}, true, "default"],
    ["global off", { global: false }, false, "global"],
    ["workspace on over global off", { global: false, workspace: true }, true, "workspace"],
    ["user off over workspace on", { global: false, workspace: true, user: false }, false, "user"],
    ["user alone", { user: false }, false, "user"],
  ] as const)("%s", (_name, layers, value, source) => expect(resolveSetting(key, layers)).toEqual({ value, source }));

  it("a scope the setting cannot be set at is never read (maintenance is global only)", () => {
    expect(resolveSetting("app.maintenance", { user: true, workspace: true })).toEqual({
      value: false,
      source: "default",
    });
  });

  it("a deployment default replaces the registry's default but never an override", () => {
    expect(resolveSetting("signup.open", {}, true)).toEqual({ value: true, source: "default" });
    expect(resolveSetting("signup.open", { [SCOPE.global]: false }, true)).toEqual({ value: false, source: "global" });
  });
});

describe("what the registry says is configurable", () => {
  it.each([
    "app.maintenance",
    "signup.open",
    "payments.enabled",
    "audit.freeFirst",
    "features.keepDocuments",
    "limits.maxFileMb",
    "plans.free.auditsPerDay",
    "plans.free.dossiersPerMonth",
  ] as const)("%s exists", (key) => expect(SETTINGS[key]).toBeDefined());
});
