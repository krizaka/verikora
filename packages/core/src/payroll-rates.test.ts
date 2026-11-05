import { describe, expect, it } from "vitest";

import { PAYROLL_RATES, PAYROLL_RATES_2026 as r, payrollRatesOf } from "./payroll-rates";

const pct = (cents: number, milli: number) => Math.round((cents * milli) / 100000);

describe("payroll rates 2026", () => {
  it("every value has an official https source read on a date", () => {
    for (const s of [...r.qpp.sources, ...r.qpip.sources, ...r.ei.sources]) {
      expect(s.url).toMatch(/^https:\/\/www\.(retraitequebec\.gouv\.qc\.ca|quebec\.ca|canada\.ca)\//);
      expect(s.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("the QPP maximum is what the rates give", () => {
    const base = pct(r.qpp.maxPensionableCents - r.qpp.basicExemptionCents, r.qpp.employeeRateMilli);
    const second = pct(r.qpp.secondCeilingCents - r.qpp.maxPensionableCents, r.qpp.secondRateMilli);
    expect(base + second).toBe(r.qpp.employeeMaxCents);
  });
  it("the QPIP maximum is what the rate gives", () =>
    expect(pct(r.qpip.maxInsurableCents, r.qpip.employeeRateMilli)).toBe(r.qpip.employeeMaxCents));
  it("the EI maximum is what the Québec rate gives", () =>
    expect(pct(r.ei.maxInsurableCents, r.ei.employeeRateMilli)).toBe(r.ei.employeeMaxCents));
  it("looks a year up, and says nothing for an unknown one", () => {
    expect(payrollRatesOf(2026)).toBe(r);
    expect(payrollRatesOf(2031)).toBeNull();
    expect(new Set(PAYROLL_RATES.map((x) => x.year)).size).toBe(PAYROLL_RATES.length);
  });
});
