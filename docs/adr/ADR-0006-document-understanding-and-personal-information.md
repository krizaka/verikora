# ADR-0006 — Document understanding and personal information, two modules behind ports

Status: accepted (2026-10-22). Issues: krizaka/verikora#148, #149.

## Context
A real receipt (Revenu Québec, registration of a start-up business) was tagged « Facture » and offered a lease check, and it holds
personal information (home address, phone, e-mail, a masked SIN). The product must say what a document is, what it holds, which
check fits — or that none does — and protect personal information (Loi 25).

## Decision
- **`lib/understanding/`** (port `DocumentUnderstanding`): generic, no import from the app. Given the extracted text it returns the
  nature with a confidence, the issuer, dates (issued / effective / due), parties, reference numbers (NEQ, GST/QST, invoice and
  reference numbers), amounts in cents, language, pages, and the **check that fits** (`CheckTarget`: a rules pack) or `null`.
  **Types, signals and identifiers are data** (`types.ts`): a new nature is a new entry. Deterministic and free.
- **The model is the application's choice, not the module's**: when the cheap pass is unsure it sets `needsModel`; a
  `ModelClassifier` (not built yet — it needs a small classify-and-extract Studio in an Sovkora pack, with its run id) would
  answer. Until then the page says the nature is undetermined and offers no default check.
- **No check applies → said plainly** (« Aucune vérification juridique ne s’applique à ce type de document ; voici ce qu’il
  contient »); a detected nature preselects the matching rules pack; the upload's « Automatique » kind follows the nature.
- **`lib/pii/`** (port `PersonalInfoScanner`): SIN/NAS (written with Luhn, or partly masked), e-mail, phone, address, postal code,
  date of birth and bank account (both only next to their label). Patterns are data. `scan` returns positions and **counts, never
  values**; the page shows counts; `redact` blanks values and backs the redacted text export. Values are never logged (the audit
  line carries counts) and never sent anywhere but the check the person starts.
- Computed from the stored text at read time: nothing new is stored, so there is nothing to purge.

## Consequences
Adding a document type or a pattern is a data change with a fixture. Personal information in a document is flagged, not removed:
the person decides (redacted export, deletion).
