import type { ComplianceReport } from "@verikora/core";

import { withPaymentClauses } from "./payment-clauses-report";
import { withSectionG } from "./section-g-report";

type Reader = Parameters<typeof withSectionG>[1];

/** Every tenant-shield rule (verikora#104) that reads the lease report's figures, in the order the report shows them. */
export async function withTenantShield(report: ComplianceReport, settings: Reader): Promise<ComplianceReport> {
  return withPaymentClauses(await withSectionG(report, settings));
}
