/**
 * Payroll contribution rates of an employee in Québec, as dated data (ADR-0014, krizaka-restricted#12, CONTENT-PAY-003). Each value
 * carries the official page it was read from and the day it was read: nothing here comes from memory. A new year is a new entry
 * read from the same four bodies, never an edit of this one. Amounts are in cents, rates in thousandths of a percent.
 */

export interface RateSource {
  /** The official page the value was read from. */
  url: string;
  /** The day the page was read (ISO). */
  readOn: string;
}

export interface PayrollRates {
  year: number;
  /** Employee RRQ/QPP: base plan 5.3 % + first additional plan 1 %, between the basic exemption and the maximum pensionable earnings. */
  qpp: {
    basicExemptionCents: number;
    maxPensionableCents: number;
    /** Employee rate of the base and first additional plans together, in thousandths of a percent (6.300 %). */
    employeeRateMilli: number;
    /** Second additional plan: employee rate between the maximum pensionable earnings and this ceiling. */
    secondCeilingCents: number;
    secondRateMilli: number;
    /** Maximum employee contribution for the year, as the official page prints it. */
    employeeMaxCents: number;
    sources: readonly RateSource[];
  };
  /** Employee RQAP (QPIP). */
  qpip: {
    maxInsurableCents: number;
    employeeRateMilli: number;
    employeeMaxCents: number;
    sources: readonly RateSource[];
  };
  /** Employee EI at the Québec rate (reduced because the RQAP exists). */
  ei: {
    maxInsurableCents: number;
    employeeRateMilli: number;
    employeeMaxCents: number;
    sources: readonly RateSource[];
  };
}

export const PAYROLL_RATES_2026: PayrollRates = {
  year: 2026,
  qpp: {
    basicExemptionCents: 350000,
    maxPensionableCents: 7460000,
    employeeRateMilli: 6300,
    secondCeilingCents: 8500000,
    secondRateMilli: 4000,
    // 6.3 % of (74 600 - 3 500) + 4 % of (85 000 - 74 600), the maximum Retraite Québec prints for 2026 ($4,895).
    employeeMaxCents: 489530,
    sources: [
      {
        url: "https://www.retraitequebec.gouv.qc.ca/en/professionals-employers/your-role-quebec-pension-plan/contributions-quebec-pension-plan-qpp",
        readOn: "2026-11-05",
      },
    ],
  },
  qpip: {
    // 103 000 $ is the maximum insurable earnings (442.90 / 0.430 %); the Québec page prints the rate and the maximum contribution.
    maxInsurableCents: 10300000,
    employeeRateMilli: 430,
    employeeMaxCents: 44290,
    sources: [
      {
        url: "https://www.quebec.ca/entreprises-et-travailleurs-autonomes/administrer-gerer/embauche-gestion-personnel/assurance-parentale/taux-cotisations",
        readOn: "2026-11-05",
      },
    ],
  },
  ei: {
    maxInsurableCents: 6890000,
    employeeRateMilli: 1300,
    employeeMaxCents: 89570,
    sources: [
      {
        url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html",
        readOn: "2026-11-05",
      },
    ],
  },
};

export const PAYROLL_RATES: readonly PayrollRates[] = [PAYROLL_RATES_2026];

export const payrollRatesOf = (year: number): PayrollRates | null => PAYROLL_RATES.find((r) => r.year === year) ?? null;
