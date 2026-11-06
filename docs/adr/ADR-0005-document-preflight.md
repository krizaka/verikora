# ADR-0005 — Document pre-flight, in its own module behind a port

Status: accepted (2026-10-22). Issue: krizaka/verikora#141.

## Context
Every check is an engine run (Sovkora) with a cost. A corrupted, encrypted, active or duplicate file must never reach it.

## Decision
- **`lib/preflight/` is its own module, generic, with no import from the app** (Folioviv can lift it as a package). Its port
  `DocumentPreflight.inspect(bytes, declared)` returns a typed outcome: `accepted` (kind, SHA-256, pages, cheap PDF facts:
  producer, creator, dates, incremental saves) or `rejected(reason)`; the application adds `reused(runId)`.
- **Rules are data** (`rules.ts`: size, allowed kinds, page limit, archive guards, the PDF names that mean active content):
  another product or a stricter policy is another rules object, not another code path.
- **Deterministic and safe**: the real type by magic bytes (name and MIME type are only compared), PDF structure read with
  pdf-lib (trailer, page tree, encryption), active content refused (JavaScript, Launch, embedded files, open/auto actions —
  `#xx`-obfuscated names decoded, catalogue and annotations walked), archives read from their directory only (entries, total
  size, ratio), nothing executed or rendered.
- **Reuse** (`lib/preflight-events.ts`): the same document (one row per tenant and SHA-256), Studio and rules (jurisdiction,
  ruleset, issuer) under the Studio version now in force reuse the recorded run: no new run, no audit spent, « résultat
  réutilisé ». Deleting a document cascades to its analyses, so a purged document is never reused. It runs before the
  entitlement is taken.
- **Metrics** (migration `0010_preflight_events`, `GET /api/admin/preflight`): accepted / rejected / reused per tenant, runs
  avoided and an estimated saving from `APP_ESTIMATED_RUN_COST_CENTS` — labelled as an estimate.

## Consequences
A refusal costs nothing and says why, in French and English. Images and Word files are recognised but not accepted yet (a rules
change, then an engine capability).
