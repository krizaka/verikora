import { isWithheldFromLandlord, landlordSignals, WITHHELD_FROM_LANDLORD } from "@verikora/core";
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { toAnalysis } from "./documents";
import { applicantSignalsOf } from "./signal-answers";

const sig = (signalId: string, level: string) => ({ signalId, level, observation: "…" });

describe("the signals over the 5 % false-positive bar are not shown to the landlord (verikora#651)", () => {
  it("withholds the three measured over the bar (sovkora-packs#191), at the measured case only", () => {
    expect(isWithheldFromLandlord(sig("PDF-ID-001", "inhabituel"))).toBe(true);
    expect(isWithheldFromLandlord(sig("PDF-META-001", "inhabituel"))).toBe(true);
    expect(isWithheldFromLandlord(sig("IMG-META-001", "inhabituel"))).toBe(true);
    expect(isWithheldFromLandlord(sig("PDF-META-001", "observé"))).toBe(false);
    expect(isWithheldFromLandlord(sig("IMG-META-001", "observé"))).toBe(false);
    expect(isWithheldFromLandlord(sig("PDF-REV-002", "inhabituel"))).toBe(false);
  });
  it("every withheld signal is over the bar and links its measurement", () => {
    for (const w of WITHHELD_FROM_LANDLORD) {
      expect(w.falsePositiveRate).toBeGreaterThan(0.05);
      expect(w.measurement).toMatch(/^https:\/\/github\.com\/krizaka\/sovkora-packs\//);
    }
  });
  it("keeps the others, in order", () => {
    expect(
      landlordSignals([
        sig("PDF-ID-001", "inhabituel"),
        sig("PDF-REV-002", "incohérent"),
        sig("PDF-META-001", "observé"),
      ]).map((s) => s.signalId),
    ).toEqual(["PDF-REV-002", "PDF-META-001"]);
  });
  it("the applicant, the console and the owner report are fed without them (the stored report keeps them for measurement)", () => {
    const row = {
      id: "a",
      studio: "document-authenticity",
      status: "succeeded",
      run_id: "r",
      blueprint_version: null,
      inputs: {},
      report: { signals: [sig("PDF-ID-001", "inhabituel"), sig("PDF-REV-002", "incohérent")], attention: true },
      error: null,
      created_at: new Date(),
      finished_at: null,
    } as never;
    const report = toAnalysis(row).report as { signals: { signalId: string }[] };
    expect(report.signals.map((s) => s.signalId)).toEqual(["PDF-REV-002"]);
    expect(applicantSignalsOf({ signals: landlordSignals([sig("PDF-ID-001", "inhabituel")]) }, new Map())).toEqual([]);
  });
});

describe("no copy claims what the corpus measured at zero recall (overlay, other font, pasted image, JPEG edit)", () => {
  it("the authenticity descriptions say what is examined, not these tampers", () => {
    for (const dict of [en, fr]) {
      const text = JSON.stringify(dict);
      for (const phrase of [
        "successive saves, fonts",
        "enregistrements successifs, polices",
        "its fonts, its images",
        "ses polices, ses images",
      ]) {
        expect(text).not.toContain(phrase);
      }
    }
  });
});
