# ADR-0008 — Account and profile behind a port (the future `@krizaka/auth`)

Status: accepted (2026-10-22). Issue: krizaka/verikora#152.

## Context
Every Krizaka product needs the same account features (name, language, avatar, e-mail change with verification, password,
export and erasure under Loi 25). Products stay independent: each keeps its own database, accounts and customers, with no
runtime dependency on a central service. What is shared is **code**, as with `@krizaka/payments`.

## Decision
- **`AccountService` is a port** (`lib/account/port.ts`): `profile`, `updateProfile`, `requestEmailChange` (the password is
  checked, a link goes to the NEW address, the answer is the same whether or not that address is taken), `confirmEmailChange`
  (single use, expires, verifies the address by that very act), `changePassword` (signs the other sessions out),
  `confirmPassword`, `deleteAccount`. It has no vendor and no Verikora code, so it can move into `@krizaka/auth` unchanged.
- **Verikora's adapter** (`lib/account/postgres.ts`) uses its own PostgreSQL, the mailer and the password hashing, passed in.
  The table grows only by what the port needs: `accounts.name`, `accounts.avatar_seed`, `email_changes`.
- **Product code stays in the product** (`lib/account/data.ts`): the **export** (profile, organisation, documents with their
  kept files, reports; never the password) and the **erasure** (refused while a subscription is active, kept files removed from
  their store, the audit trail stripped of name, address and detail, then the identity deleted).
- **Each section is a route** (`/app/settings/profil | securite | facturation | donnees`); the tab is the URL. Billing is the
  Stripe portal. The e-mail change fails closed (503 `MAIL_OFF`) while no mail provider is configured.

## Consequences
- Moving to `@krizaka/auth` is an adapter and configuration change, not a rewrite.
- The mailed link opens a page whose button POSTs (a mail scanner cannot spend it).
