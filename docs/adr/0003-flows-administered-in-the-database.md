# ADR-0003 — Flows are administered in the database

- **Status**: accepted (2026-10-17, Oussama)
- **Context**: Verikora will carry many flows — a lease check for a tenant, for a landlord, a freelance contract, an invoice,
  a tenant screening. Until now the audiences (`AUDIENCES`), what each is offered (`firstCheck`), the jurisdictions and the
  « Pour qui ? » picker were constants in the code: adding or switching off a flow was a release.

## Decision

A **flow** is data: the platform administrator (admin.verikora.com) defines and administers it; the app only reads it.

**Schema** (migration `0006_flows`):

| table | holds |
|:---|:---|
| `flows` | `id`, `key` (`lease-check-tenant`), `current_version_id`, `created_at` |
| `flow_versions` | `id`, `flow_id`, `version` (1, 2, …), `status` (`draft` · `published` · `retired`), `definition` (jsonb), `created_by`, `published_at` — a published version is **immutable** |
| `flow_environments` | `flow_id`, `environment` (`dev`, `prod`), `enabled` — a flow is enabled per environment |
| `consents` | `account_id`, `key`, `granted_at`, `revoked_at` — what the person agreed to |
| `analyses.flow_version_id` | the exact version that produced a check |

**The definition** (`flowDefinition` in `@verikora/core`, validated by zod on both sides): `title` and `lead` in `en`/`fr`;
`status` (`available` · `soon`); `audiences` (who it is offered to); `steps` — each step names the **Sovkora Studio**, its
**pack**, and the **rulesets by jurisdiction** (data, never code: `QC → qc-residential-lease`); `consents` (keys the person
must have granted before the flow runs); `providers` (external providers a step uses, e.g. a credit bureau); `pricing`
(`free` · `per-run` · `subscription`, amount in cents CAD).

**Reading** (`lib/flows.ts`): the app asks for *the flows available to this user in this environment* — published current
version, enabled for `APP_ENVIRONMENT`, offered to the person's audience. Everything that was a constant is derived from it:
the « Pour qui ? » picker and the audience pages (an audience with no enabled flow is hidden — and its page is a 404), the
onboarding choices, and the Studio offer on a document (which checks, which jurisdictions). The public pages fall back to the
seeded definitions only when the database cannot be reached, so a build or an outage never blanks the landing.

**Rules**

1. **A published version never changes.** Editing creates a draft (a copy of the current version); publishing makes it the
   current version. Old analyses keep the `flow_version_id` they ran with, and a report is signed with its own payload (ruleset
   and version inside) — so publishing v2 never invalidates a v1 report (tested).
2. **A disabled flow is hidden** everywhere in the environment and cannot be started (API: 403 `FLOW_NOT_OFFERED`).
3. **Required consents are enforced server-side**: starting a flow whose definition lists `consents` without the person having
   granted each one is refused (403 `CONSENT_REQUIRED`) — never only hidden in the UI. Granting and withdrawing are audit-logged.
4. **Every administration action is audit-logged** (`flow.created`, `flow.draft_saved`, `flow.published`,
   `flow.environment_set`) with the actor and the version.
5. **Nothing is hard-coded but the vocabulary**: audiences keep their words in `messages/` (the keys are the vocabulary); which
   audiences, studios and jurisdictions are *offered* is data. The existing flows are seeded (`SEED_FLOWS`), idempotently, at start.
6. The platform admin edits flows on admin.verikora.com (people with the ADMIN role from an allowed address, as for every
   administration page): a list (Krizaka UI `DataTable`), a create/edit form, publish and enable-per-environment actions.

## Consequences

- Adding an audience's flow, switching one off, or changing its rulesets is an administration action, not a release.
- A new Studio or a new ruleset still needs its Sovkora pack (the engine) — the flow only points to it.
- The `AUDIENCES` constant remains as the **vocabulary** (labels, URLs); a new audience key is a code change once.
- Pricing is recorded, not yet charged (no payment flow exists).
