import { describe, expect, it } from "vitest";

import { VERIKORA_RULES } from "../preflight/rules";
import { auditCapsOf, clientConfigOf, maintenanceOf, preflightRulesFrom, type Snapshot } from "./boundary";
import { defOf, SETTING_KEYS, type SettingKey } from "./registry";

/** A snapshot of the defaults, with some values changed. */
const snapshot = (changes: Partial<Record<SettingKey, unknown>> = {}): Snapshot =>
  Object.fromEntries(
    SETTING_KEYS.map((k) => [
      k,
      k in changes ? { value: changes[k], source: "global" } : { value: defOf(k).default, source: "default" },
    ]),
  ) as Snapshot;

describe("the pre-flight rules follow the configuration", () => {
  it("keeps the product's rules and applies the limits an administrator set", () => {
    const rules = preflightRulesFrom(
      VERIKORA_RULES,
      snapshot({ "limits.maxFileMb": 2, "limits.maxPages": 30, "limits.allowedTypes": ["pdf"] }),
    );
    expect(rules).toMatchObject({ maxBytes: 2 * 1024 * 1024, maxPages: 30, allowedKinds: ["pdf"] });
    expect(rules.pdfActiveNames).toEqual(VERIKORA_RULES.pdfActiveNames);
  });
  it("the defaults are the product's own rules", () => {
    expect(preflightRulesFrom(VERIKORA_RULES, snapshot())).toEqual(VERIKORA_RULES);
  });
  it("allows both Word formats through the existing database-backed word setting", () => {
    expect(preflightRulesFrom(VERIKORA_RULES, snapshot({ "limits.allowedTypes": ["word"] })).allowedKinds).toEqual([
      "docx",
      "odt",
    ]);
    expect(
      preflightRulesFrom(VERIKORA_RULES, snapshot({ "limits.allowedTypes": ["pdf", "text", "image"] })).allowedKinds,
    ).not.toContain("odt");
  });
});

describe("maintenance", () => {
  it.each([
    [false, false],
    [true, true],
  ])("on=%s", (set, on) => expect(maintenanceOf(snapshot({ "app.maintenance": set })).on).toBe(on));
  it("carries its message in both languages", () => {
    const m = maintenanceOf(snapshot({ "app.maintenanceMessage": { fr: "Retour à 14 h.", en: "Back at 2 pm." } }));
    expect(m.message).toEqual({ fr: "Retour à 14 h.", en: "Back at 2 pm." });
  });
});

describe("the audit caps of a plan: the included volume is the catalogue entry's, the rest the settings'", () => {
  it.each([
    ["pro", 100, {}, { perMonth: 100, perDay: 0, freeDossiers: 1, overageCents: 0 }],
    [
      "pro",
      750,
      { "limits.bonusAuditsPerMonth": 20, "plans.pro.auditsPerDay": 10 },
      { perMonth: 770, perDay: 10, freeDossiers: 1, overageCents: 0 },
    ],
    [
      "free",
      0,
      { "plans.free.auditsPerDay": 3, "audit.freeFirst": false },
      { perMonth: Number.POSITIVE_INFINITY, perDay: 3, freeDossiers: 0, overageCents: 0 },
    ],
  ] as const)("%s including %i with %j", (plan, included, changes, caps) =>
    expect(auditCapsOf(snapshot(changes), plan, included)).toEqual(caps),
  );

  it("no setting holds a plan's included volume any more (the catalogue does)", () =>
    expect(Object.keys(snapshot({}))).not.toContain("plans.pro.auditsPerMonth"));
});

describe("what the browser may know", () => {
  it("is the limits, the features it shows and the payment display — nothing else", () => {
    const c = clientConfigOf(snapshot({ "features.keepDocuments": false, "payments.display": "live" }));
    expect(c).toEqual({
      maxFileBytes: 10 * 1024 * 1024,
      allowedTypes: ["pdf", "text", "image", "word"],
      features: { keepDocuments: false, ownStorage: true, documentInsight: true, assistant: false, batches: true },
      payments: { enabled: true, display: "live" },
      avatars: { enabled: true, maxBytes: 512 * 1024, seeds: ["v1", "v2", "v3", "v4", "v5", "v6"] },
    });
  });

  it("says which avatars the administrator allows, how heavy an uploaded one may be, and whether avatars are on", () => {
    const c = clientConfigOf(
      snapshot({ "features.collectionAvatars": false, "limits.avatarMaxKb": 128, "features.avatarSet": ["v2", "v3"] }),
    );
    expect(c.avatars).toEqual({ enabled: false, maxBytes: 128 * 1024, seeds: ["v2", "v3"] });
  });
});
