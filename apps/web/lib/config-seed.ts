import type { Query } from "@krizaka/db";

/**
 * The configuration rows the application expects at start (krizaka-internal#2044): screening providers, check types, retention
 * policies and rules, document types, compliance gates. They used to be inserted by migrations; they are code now, applied at
 * every start and by `pnpm db:rebuild`, and idempotent: a row an administrator has edited is never overwritten (ON CONFLICT DO NOTHING).
 * Order matters (foreign keys).
 */
export const CONFIG_SEED: readonly string[] = [
  // screening_provider
  `INSERT INTO public.screening_provider (id, adapter, label, region, enabled, note, poll_minutes, poll_max) VALUES ('demo', 'demo', 'Demonstration', 'CA', true, 'Fictitious data, deterministic.', 15, 96) ON CONFLICT DO NOTHING;
INSERT INTO public.screening_provider (id, adapter, label, region, enabled, note, poll_minutes, poll_max) VALUES ('engine', 'engine', 'Sovkora external checks', 'CA', true, 'Routes to the vendors by data. Every call answers NOT_CONFIGURED until a provider account exists and the compliance gate is open.', 15, 96) ON CONFLICT DO NOTHING;`,
  // check_type
  `INSERT INTO public.check_type (key, provider_id, purpose, label_fr, label_en, provider_cost_cents, margin_cents, currency, region, consent_notice_version, enabled, default_on, requires_lawyer, note, applicant_may_pay) VALUES ('payment-history', 'demo', 'COURT_RECORDS', 'Historique de paiement', 'Payment history', 0, 0, 'CAD', 'QC', '2026-10-24.2', true, true, NULL, 'Demonstration only until a provider agreement is signed.', false) ON CONFLICT DO NOTHING;
INSERT INTO public.check_type (key, provider_id, purpose, label_fr, label_en, provider_cost_cents, margin_cents, currency, region, consent_notice_version, enabled, default_on, requires_lawyer, note, applicant_may_pay) VALUES ('credit', 'engine', 'CREDIT', 'Rapport de crédit', 'Credit report', 0, 0, 'CAD', 'QC', '2026-10-24.2', true, false, NULL, 'Price to be set when the provider agreement is signed. Offered to an owner by a tenant_check_setting row.', false) ON CONFLICT DO NOTHING;
INSERT INTO public.check_type (key, provider_id, purpose, label_fr, label_en, provider_cost_cents, margin_cents, currency, region, consent_notice_version, enabled, default_on, requires_lawyer, note, applicant_may_pay) VALUES ('criminal-record', 'engine', 'COURT_RECORDS', 'Antécédents judiciaires', 'Criminal record', 0, 0, 'CAD', 'QC', '2026-10-24.2', false, false, 'criminal-records-lawful', 'OFF. Not offered to Québec landlords until a lawyer confirms it is lawful for rental (Charter, CDPDJ).', false) ON CONFLICT DO NOTHING;`,
  // retention_policies
  `INSERT INTO public.retention_policies (id, purge_on, days) VALUES ('after-check', 'after-check', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.retention_policies (id, purge_on, days) VALUES ('after-decision', 'after-decision', NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.retention_policies (id, purge_on, days) VALUES ('thirty-days', 'days', 30) ON CONFLICT DO NOTHING;`,
  // retention_rule
  `INSERT INTO public.retention_rule (id, owner_id, subject, policy_id) VALUES ('b49e8aba-c3cb-432e-bbd6-a4cb28767f1d', NULL, 'screening-result', 'thirty-days') ON CONFLICT DO NOTHING;`,
  // document_types
  `INSERT INTO public.document_types (id, accepted_kinds, studios, fields, retention_policy, active, "position") VALUES ('pay-stub', '{pdf}', '{document-authenticity,compliance-check}', '{employer,pay-period}', 'after-decision', true, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.document_types (id, accepted_kinds, studios, fields, retention_policy, active, "position") VALUES ('bank-statement', '{pdf}', '{document-authenticity,compliance-check}', '{statement-period}', 'after-decision', true, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.document_types (id, accepted_kinds, studios, fields, retention_policy, active, "position") VALUES ('employment-letter', '{pdf}', '{document-authenticity,compliance-check}', '{employer,position,start-date}', 'after-decision', true, 3) ON CONFLICT DO NOTHING;
INSERT INTO public.document_types (id, accepted_kinds, studios, fields, retention_policy, active, "position") VALUES ('identity-document', '{pdf}', '{document-authenticity,compliance-check}', '{full-name}', 'after-check', true, 4) ON CONFLICT DO NOTHING;`,
  // compliance_gate
  `INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('reseller-agreements', 'Signed reseller/partner agreement with each provider (permissible purpose, resale)', true, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('lawyer-credit-for-rental', 'Lawyer sign-off on credit checks for rental', true, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('efvp', 'Privacy impact assessment (EFVP, Loi 25) completed and filed', true, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('consent-text', 'Per-check consent text (specific, written; logged with version, price and payer) reviewed by the lawyer', true, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('provider-residency', 'Provider data residency verified as Canada', true, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('adverse-action-wording', 'Adverse-action wording reviewed by a lawyer', true, 'open', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.compliance_gate (blocker, label, required_live, status, evidence_on, evidence_ref) VALUES ('criminal-records-lawful', 'A lawyer confirms criminal-record checks are lawful for rental (only for that check type; not needed for credit)', false, 'open', NULL, NULL) ON CONFLICT DO NOTHING;`,
];

export async function seedConfig(query: Query): Promise<void> {
  const statements = CONFIG_SEED.flatMap((block) => block.split("\n")).filter((statement) => statement.trim());
  for (const statement of statements) {
    await query(statement);
  }
}
