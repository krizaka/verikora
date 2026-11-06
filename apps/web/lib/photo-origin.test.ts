import { SIGNAL_LEVELS } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { photoOriginSignals } from "./photo-origin";

const phone = {
  software: "17.5.1",
  device: "Apple iPhone 15",
  takenAt: "2026-01-03T14:15:00.000Z",
  modifiedAt: "2026-01-03T14:15:00.000Z",
  hadGps: false,
};
const ids = (origin: Parameters<typeof photoOriginSignals>[0]) =>
  photoOriginSignals(origin).map((s) => `${s.signalId}:${s.level}`);

describe("a photo document's origin as signals (verikora#229)", () => {
  it("a phone photo saved as it was taken reports its device and raises nothing", () => {
    expect(ids(phone)).toEqual(["IMG-META-001:observé"]);
    expect(photoOriginSignals(phone)[0]!.facts).toEqual({ device: "Apple iPhone 15", software: "17.5.1" });
  });

  it("a photo saved again days after it was taken is unusual; saved before it was taken, inconsistent", () => {
    expect(ids({ ...phone, modifiedAt: "2026-01-05T09:00:00.000Z" })).toContain("IMG-META-003:inhabituel");
    expect(ids({ ...phone, modifiedAt: "2025-12-01T08:00:00.000Z" })).toContain("IMG-META-004:incohérent");
    expect(ids({ ...phone, modifiedAt: "2026-01-03T14:15:40.000Z" })).toEqual(["IMG-META-001:observé"]);
  });

  it("no metadata at all is unusual; software without a device is a screenshot or an export", () => {
    expect(ids(null)).toEqual(["IMG-META-001:inhabituel"]);
    expect(ids({ software: null, device: null, takenAt: null, modifiedAt: null, hadGps: false })).toEqual([
      "IMG-META-001:inhabituel",
    ]);
    expect(ids({ ...phone, device: null, takenAt: null, modifiedAt: null, software: "macOS Screenshot" })).toEqual([
      "IMG-META-001:observé",
      "IMG-META-005:observé",
    ]);
  });

  it("a GPS position is said to have been removed, never given", () => {
    const signals = photoOriginSignals({ ...phone, hadGps: true });
    expect(signals.map((s) => s.signalId)).toContain("IMG-GPS-001");
    expect(JSON.stringify(signals)).not.toMatch(/latitude|longitude|\d+\/\d+/);
  });

  it("every level is one of the report's three", () => {
    for (const origin of [null, phone, { ...phone, modifiedAt: "2025-01-01T00:00:00.000Z", hadGps: true }])
      for (const s of photoOriginSignals(origin)) expect(SIGNAL_LEVELS).toContain(s.level);
  });
});
