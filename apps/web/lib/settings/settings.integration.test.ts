import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { assertFeature, assertOpen, FEATURE, type Feature, maintenance, settingsFor } from "./guards";
import { appSettings } from "./instance";
import { seedLegacyValues } from "./seed";
import { GLOBAL, postgresVerikoraSettings, type ScopeRef, SettingsError } from "./service";

/** The settings service against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
const ADMIN = { id: null, label: "admin@verikora.test" };

describe.runIf(enabled)("settings (ADR-0009)", () => {
  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM app_settings");
    await query("DELETE FROM settings_audit");
  });
  const workspaces = new Map<string, string>();
  const service = postgresVerikoraSettings({ query, workspaceOf: async (u) => workspaces.get(u) ?? null, cacheMs: 0 });
  const user = (id: string): ScopeRef => ({ scope: "user", id });
  const workspace = (id: string): ScopeRef => ({ scope: "workspace", id });

  it("returns the default until something is set, then the global value", async () => {
    expect(await service.get("features.documentInsight")).toBe(true);
    await service.set(ADMIN, GLOBAL, "features.documentInsight", false, NOW);
    expect(await service.get("features.documentInsight")).toBe(false);
  });

  it("resolves user over workspace over global, and says where each value comes from", async () => {
    workspaces.set("u1", "w1");
    await service.set(ADMIN, workspace("w1"), "features.documentInsight", true, NOW);
    expect(await service.get("features.documentInsight", { userId: "u1" })).toBe(true);
    expect(await service.get("features.documentInsight", { userId: "somebody-else" })).toBe(false);
    await service.set(ADMIN, user("u1"), "features.documentInsight", false, NOW);
    expect(await service.get("features.documentInsight", { userId: "u1" })).toBe(false);
    expect((await service.snapshot({ userId: "u1" }))["features.documentInsight"]).toEqual({
      value: false,
      source: "user",
    });
    await service.reset(ADMIN, user("u1"), "features.documentInsight", NOW);
    expect((await service.snapshot({ userId: "u1" }))["features.documentInsight"]).toEqual({
      value: true,
      source: "workspace",
    });
  });

  it("refuses a value that is not valid, a setting that does not exist and a scope it cannot be set at", async () => {
    await expect(service.set(ADMIN, GLOBAL, "limits.maxFileMb", 50, NOW)).rejects.toMatchObject({
      status: 400,
      code: "BAD_VALUE",
    });
    await expect(service.set(ADMIN, GLOBAL, "features.documentInsight", "yes", NOW)).rejects.toMatchObject({
      code: "BAD_VALUE",
    });
    await expect(service.set(ADMIN, GLOBAL, "nothing.here", true, NOW)).rejects.toMatchObject({
      status: 404,
      code: "UNKNOWN_SETTING",
    });
    await expect(service.set(ADMIN, user("u1"), "app.maintenance", true, NOW)).rejects.toMatchObject({
      code: "BAD_SCOPE",
    });
    await expect(
      service.set(ADMIN, { scope: "user", id: "" }, "features.documentInsight", true, NOW),
    ).rejects.toBeInstanceOf(SettingsError);
    expect(await service.get("app.maintenance")).toBe(false);
  });

  it("keeps who changed what, when, before and after — and a reset is recorded too", async () => {
    await service.set(ADMIN, GLOBAL, "payments.display", "live", NOW);
    await service.set(ADMIN, GLOBAL, "payments.display", "test", new Date("2026-10-22T13:00:00Z"));
    await service.reset(ADMIN, GLOBAL, "payments.display", new Date("2026-10-22T14:00:00Z"));
    const h = await service.history({ key: "payments.display" });
    expect(h.map((e) => [e.before, e.after])).toEqual([
      ["test", null],
      ["live", "test"],
      [null, "live"],
    ]);
    expect(h[0]).toMatchObject({
      actorLabel: "admin@verikora.test",
      scope: "global",
      scopeId: "",
      at: "2026-10-22T14:00:00.000Z",
    });
    expect(await service.get("payments.display")).toBe("test");
  });

  it("a change is visible at once on this instance even with a cache", async () => {
    const cached = postgresVerikoraSettings({ query, cacheMs: 60_000, clock: () => 1 });
    expect(await cached.get("audit.freeFirst")).toBe(true);
    await cached.set(ADMIN, GLOBAL, "audit.freeFirst", false, NOW);
    expect(await cached.get("audit.freeFirst")).toBe(false);
  });

  it("a deployment default is used until an override exists", async () => {
    const legacy = postgresVerikoraSettings({ query, cacheMs: 0, defaults: { "signup.open": true } });
    expect(await legacy.get("signup.open")).toBe(true);
    await legacy.set(ADMIN, GLOBAL, "signup.open", false, NOW);
    expect(await legacy.get("signup.open")).toBe(false);
  });

  it("lists what is overridden at a scope", async () => {
    await service.set(ADMIN, user("u9"), "limits.bonusAuditsPerMonth", 20, NOW);
    expect(await service.overrides(user("u9"))).toEqual({ "limits.bonusAuditsPerMonth": 20 });
  });
});

/** The checks at the server boundary: a switch that is off is refused by the server, not just hidden. */
describe.runIf(enabled)("settings at the server boundary", () => {
  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM app_settings");
  });
  afterAll(async () => {
    await query("DELETE FROM app_settings");
  });

  it("maintenance closes the app to a person with a message in both languages, and never to an administrator", async () => {
    await appSettings().set(ADMIN, GLOBAL, "app.maintenance", true, NOW);
    await appSettings().set(
      ADMIN,
      GLOBAL,
      "app.maintenanceMessage",
      { fr: "Retour à 14 h.", en: "Back at 2 pm." },
      NOW,
    );
    await expect(assertOpen({ role: "USER" })).rejects.toMatchObject({
      status: 503,
      body: { code: "MAINTENANCE", message: { fr: "Retour à 14 h.", en: "Back at 2 pm." } },
    });
    await expect(assertOpen({ role: "ADMIN" })).resolves.toBeUndefined();
    expect((await maintenance()).on).toBe(true);
    await appSettings().set(ADMIN, GLOBAL, "app.maintenance", false, NOW);
    await expect(assertOpen({ role: "USER" })).resolves.toBeUndefined();
  });

  it.each(Object.keys(FEATURE) as Feature[])(
    "%s: when it is off the server refuses it with 403 FEATURE_OFF, for one person only if set for them",
    async (feature) => {
      const other = "00000000-0000-4000-8000-000000000002";
      await appSettings()
        .set(ADMIN, { scope: "user", id: other }, FEATURE[feature], !(await appSettings().get(FEATURE[feature])), NOW)
        .catch(() => undefined);
      await appSettings().set(ADMIN, GLOBAL, FEATURE[feature], false, NOW);
      await expect(assertFeature(feature, null)).rejects.toMatchObject({
        status: 403,
        body: { code: "FEATURE_OFF", feature },
      });
      await appSettings().reset(ADMIN, GLOBAL, FEATURE[feature], NOW);
    },
  );

  it("a feature off for one person leaves the others alone (a beta, a quota)", async () => {
    const beta = "00000000-0000-4000-8000-000000000003";
    await appSettings().set(ADMIN, { scope: "user", id: beta }, "features.assistant", true, NOW);
    await expect(assertFeature("assistant", beta)).resolves.toBeUndefined();
    await expect(assertFeature("assistant", "00000000-0000-4000-8000-000000000004")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("a person's snapshot carries their own bonus quota", async () => {
    const id = "00000000-0000-4000-8000-000000000005";
    await appSettings().set(ADMIN, { scope: "user", id }, "limits.bonusAuditsPerMonth", 20, NOW);
    expect((await settingsFor(id))["limits.bonusAuditsPerMonth"]).toEqual({ value: 20, source: "user" });
    expect((await settingsFor(null))["limits.bonusAuditsPerMonth"]).toEqual({ value: 0, source: "default" });
  });

  it("legacy environment values are written once at start, only when they differ from the default and nobody set them since", async () => {
    await query("DELETE FROM app_settings");
    const service = postgresVerikoraSettings({ query, cacheMs: 0 });
    expect(await seedLegacyValues(service, { signupOpen: true, purgeAfterHours: 24 }, NOW)).toEqual(["signup.open"]);
    expect(await service.get("signup.open")).toBe(true);
    await service.set(ADMIN, GLOBAL, "signup.open", false, NOW);
    expect(await seedLegacyValues(service, { signupOpen: true, purgeAfterHours: 24 }, NOW)).toEqual([]);
    expect(await service.get("signup.open")).toBe(false);
  });
});
