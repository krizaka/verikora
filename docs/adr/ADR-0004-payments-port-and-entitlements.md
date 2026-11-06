# ADR-0004 — Payments behind a port, entitlements as data

Status: accepted (2026-10-22). Issue: krizaka/verikora#138.

## Context
Verikora offers the first verification free, then sells per document or by subscription (Agencies, Law firms) — the grid is
the price catalogue's (ADR-009, krizaka/.github#253, verikora#367), never typed here. The org rules: the domain has no
infrastructure and no vendor SDK, a vendor is chosen in configuration, prices and rules are data.

## Decision
- **A payments port** (the shared `@krizaka/payments` port): `createCustomer`, `checkout`, `portal`, `parseWebhook`. It speaks plans and
  **vendor-free events** (`payment_paid {kind}`, `subscription_started`, `subscription_changed`). The domain (`lib/billing.ts`) imports
  nothing from a vendor.
- **The adapter is configuration**: `@krizaka/payments` (krizaka-ui ADR-005; a small client over `fetch`, no SDK) is chosen by
  `PAYMENTS_PROVIDER` in `lib/payments/config.ts`, the only file that reads the environment for payments. Another processor
  is another adapter.
- **Prices are data in the catalogue** (`@krizaka/settings` 0.2, ADR-009): `lib/pricing.ts` is its seed, the administrator schedules
  a change from a date (`/config/prices`, audited), a subscription records the version it was sold at (`accounts.subscription_price_*`)
  and keeps it; the verifications it includes are that version's `included` limit. The processor's prices (`deploy/payments-catalogue.json`,
  created by `pnpm payments:setup`, lookup keys in `lib/pricing.ts` `SOLD`) equal the seed (`lib/pricing.test.ts`); a checkout refuses
  (503 `PRICE_MISMATCH`) while the processor's amount differs from the catalogue's. No amount is typed in the code or the messages.
  Verifications beyond the included volume are **not billed** (usage-based billing is not wired): past it, the account is held at the cap until next month (429 `FAIR_USE`). The catalogue therefore holds no per-verification price beyond the included volume, and no page may advertise one (verikora#373, `lib/prices/billed-charges.test.ts`). Metered billing would come with its own entry, its processor price and its test.
- **Taxes**: the processor's automatic tax (GST 5 % + QST 9.975 % for Québec) and its invoices carry Krizaka's registration numbers.
- **Entitlements** (migration `0009_billing`): `accounts.free_audit_used_at`, `audit_credits`, `plan`, `subscription_status`,
  `current_period_end`, `payment_customer_id`; `payment_events(id)` makes each notification apply once. The free audit and
  a credit are taken with a single conditional `UPDATE` (no double spend) and given back if the run cannot start.
- **Exempt**: accounts an operator created (QA, personas) have no `terms_accepted_at` and are never charged.

## Consequences
The webhook is the only writer of paid state. Live mode is a change of keys and of the processor account, not of code.
