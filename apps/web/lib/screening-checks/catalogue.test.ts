import { describe, expect, it } from "vitest";

import { allowedTypes, type CheckTypeRow, priceCents, type ProviderRow, type SettingRow } from "./catalogue";
import { closedDoor, engineProvider, NOT_CONFIGURED } from "./providers";

const provider = (id: string, enabled = true): ProviderRow => ({ id, adapter: id === "demo" ? "demo" : "engine", label: id, region: "CA", enabled, note: null });
const type = (key: string, over: Partial<CheckTypeRow> = {}): CheckTypeRow => ({
  key, provider_id: "engine", purpose: "CREDIT", label_fr: key, label_en: key, provider_cost_cents: 0, margin_cents: 0, currency: "CAD", region: "QC",
  consent_notice_version: "v1", enabled: true, default_on: false, requires_lawyer: null, note: null, ...over,
});
const setting = (check_type: string, allowed: boolean): SettingRow => ({ owner_id: "o1", check_type, allowed });

describe("which check types an owner may request (data, no deploy)", () => {
  const types = [type("payment-history", { provider_id: "demo", default_on: true }), type("credit"), type("sensitive", { enabled: false, default_on: true })];
  const providers = [provider("demo"), provider("engine")];

  it("offers the defaults to an owner with no row", () => {
    expect(allowedTypes(types, [], providers).map((t) => t.key)).toEqual(["payment-history"]);
  });
  it("lets an owner's own row switch a type on or off", () => {
    expect(allowedTypes(types, [setting("credit", true)], providers).map((t) => t.key)).toEqual(["payment-history", "credit"]);
    expect(allowedTypes(types, [setting("payment-history", false)], providers)).toEqual([]);
  });
  it("never offers a disabled type, even when the owner's row allows it", () => {
    expect(allowedTypes(types, [setting("sensitive", true)], providers).map((t) => t.key)).not.toContain("sensitive");
  });
  it("never offers a type whose provider is switched off", () => {
    expect(allowedTypes(types, [setting("credit", true)], [provider("demo"), provider("engine", false)]).map((t) => t.key)).toEqual(["payment-history"]);
  });
  it("charges the provider's cost plus the margin, both read from the row", () => {
    expect(priceCents(type("c", { provider_cost_cents: 1200, margin_cents: 700 }))).toBe(1900);
  });
});

describe("the engine's door while no provider account exists", () => {
  const call = { userId: "u", runId: "r", subject: { subjectId: "s", firstName: "A", lastName: "B" }, region: "QC" };
  it("answers NOT_CONFIGURED to a submission and to a collection, never a result", async () => {
    const provider = engineProvider(closedDoor);
    expect(await provider.submit("CREDIT", call)).toEqual(NOT_CONFIGURED);
    expect(await provider.collect("CREDIT", call, "ref")).toEqual(NOT_CONFIGURED);
    expect(NOT_CONFIGURED).toMatchObject({ outcome: "REFUSED", refusal: "NOT_CONFIGURED" });
    expect(provider.demo).toBe(false);
  });
});
