/**
 * The schema, as ordered migrations applied once each (lib/db.ts `migrate`, at server start, under an advisory lock).
 * Kept in code rather than in .sql files so the standalone server carries them. A migration is never edited once
 * deployed: a change is a new entry.
 */
import { accountsMigration } from "@krizaka/auth";
import { pricesMigration } from "@krizaka/settings";
import { webhooksMigration } from "@krizaka/webhooks";

import { DEFAULT_COLLECTION_MIGRATION } from "./organisation/default-collection";
import { WORKSPACE_MIGRATION } from "./workspace/migration";

export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: "0001_initial",
    sql: `
CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  role          text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  locale        text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fr')),
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

-- A web session: the cookie holds a random token, the table its keyed hash (a leaked table opens nothing).
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_account ON sessions(account_id);

-- A document and its file. The MVP keeps the file here (bytea, ≤ 10 MB): no storage service to pay for or secure yet.
-- text is the PDF's text layer (or the text file), read at upload — the input of Orazaka's compliance Studio and of search.
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title       text NOT NULL,
  filename    text NOT NULL,
  mime_type   text NOT NULL CHECK (mime_type IN ('application/pdf', 'text/plain')),
  kind        text NOT NULL DEFAULT 'other' CHECK (kind IN ('lease', 'contract', 'invoice', 'other')),
  size_bytes  integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256      text NOT NULL,
  pages       integer,
  content     bytea NOT NULL,
  text        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  search      tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(text, '')), 'B')
              ) STORED,
  UNIQUE (owner_id, sha256)
);
CREATE INDEX documents_owner ON documents(owner_id, created_at DESC);
CREATE INDEX documents_search ON documents USING gin(search);

-- An analysis is an Orazaka run: its id (the trace), its status as Orazaka last said it, the report Orazaka returned.
CREATE TABLE analyses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  studio            text NOT NULL CHECK (studio IN ('compliance-check', 'document-authenticity')),
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  run_id            text,
  blueprint_version text,
  inputs            jsonb NOT NULL DEFAULT '{}',
  report            jsonb,
  error             text,
  search_text       text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);
CREATE INDEX analyses_document ON analyses(document_id, created_at DESC);
CREATE INDEX analyses_search ON analyses USING gin(to_tsvector('simple', search_text));

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_label text NOT NULL,
  action      text NOT NULL,
  target_id   text,
  detail      jsonb NOT NULL DEFAULT '{}',
  ip          text
);
CREATE INDEX audit_log_at ON audit_log(at DESC);
`,
  },
  {
    version: "0002_showcase",
    sql: `
-- A document an administrator has declared a sample (non-personal): the only kind a public showcase may show.
ALTER TABLE documents ADD COLUMN sample boolean NOT NULL DEFAULT false;
-- The analysis the public page shows (at most one at a time: promoting another replaces it). Set by an administrator only.
ALTER TABLE analyses ADD COLUMN showcase boolean NOT NULL DEFAULT false;
CREATE INDEX analyses_showcase ON analyses(finished_at DESC) WHERE showcase;
`,
  },
  {
    version: "0003_report_grants",
    sql: `
-- Verifying a signed report is for the people the report's owner gave access to (ADR-0002). A grant names an e-mail:
-- a member of that address has access at once, and an address with no account yet is an invitation honoured the day the
-- account exists (sign-up is closed on dev, so the row waits). Revoked or past its expiry, a grant opens nothing.
CREATE TABLE report_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id   uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  granted_by    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  grantee_email text NOT NULL CHECK (grantee_email = lower(grantee_email)),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz
);
CREATE UNIQUE INDEX report_grants_live ON report_grants(analysis_id, grantee_email) WHERE revoked_at IS NULL;
CREATE INDEX report_grants_email ON report_grants(grantee_email);

-- "Request access": a signed-in member asks the owner for a report they cannot verify; the owner sees it beside the grants.
CREATE TABLE report_access_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  requester_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requester_email text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  handled_at      timestamptz
);
CREATE UNIQUE INDEX report_access_requests_open ON report_access_requests(analysis_id, requester_id) WHERE handled_at IS NULL;
`,
  },
  {
    version: "0004_perspective",
    sql: `
-- Which side of the lease the person is on (chosen at onboarding, changeable in settings): drives the default checks and the wording.
ALTER TABLE accounts ADD COLUMN perspective text CHECK (perspective IN ('tenant', 'landlord'));
`,
  },
  {
    version: "0005_audiences",
    sql: `
-- « Pour qui ? » grows past the two sides of a lease: freelancers and small businesses (offered as « soon » until their rules exist).
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_perspective_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_perspective_check CHECK (perspective IN ('tenant', 'landlord', 'freelancer', 'business'));
`,
  },
  {
    version: "0006_flows",
    sql: `
-- Flows are data, administered on admin.yomizaka.com (ADR-0003). A published version never changes.
CREATE TABLE flows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9-]{1,60}$'),
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE flow_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id      uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  definition   jsonb NOT NULL,
  created_by   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (flow_id, version)
);
ALTER TABLE flows ADD CONSTRAINT flows_current_version FOREIGN KEY (current_version_id) REFERENCES flow_versions(id) ON DELETE SET NULL;
CREATE TABLE flow_environments (
  flow_id     uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('dev', 'prod')),
  enabled     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (flow_id, environment)
);
-- What a person agreed to (a flow may require it): granted, then maybe withdrawn.
CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z0-9-]{1,40}$'),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX consents_live ON consents(account_id, key) WHERE revoked_at IS NULL;
-- The exact flow version that produced a check: publishing a new version never touches an old analysis.
ALTER TABLE analyses ADD COLUMN flow_version_id uuid REFERENCES flow_versions(id) ON DELETE SET NULL;
`,
  },
  {
    version: "0007_screenings",
    sql: `
-- A landlord asks, the tenant consents (or declines), sees the result first, shares it or contests it. Minimal data: a short
-- summary is kept, never a provider's raw report, and it is deleted when result_expires_at passes (docs/product/tenant-screening-research.md).
CREATE TABLE screenings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_name       text NOT NULL,
  tenant_email      text NOT NULL CHECK (tenant_email = lower(tenant_email)),
  scope             text[] NOT NULL DEFAULT '{payment-history}',
  provider          text NOT NULL,
  status            text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'consented', 'shared', 'declined', 'contested', 'expired')),
  token_hash        text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  consented_at      timestamptz,
  shared_at         timestamptz,
  contested_at      timestamptz,
  contest_comment   text,
  result            jsonb,
  result_expires_at timestamptz,
  purged_at         timestamptz
);
CREATE INDEX screenings_landlord ON screenings(landlord_id, created_at DESC);
`,
  },
  {
    version: "0008_signup",
    sql: `
-- Self-serve sign-up (2026-10-21): the address is verified by a mailed link, the terms and the privacy notice accepted
-- (version and date kept: Loi 25 consent). Existing accounts (QA, operators) are verified by construction.
ALTER TABLE accounts ADD COLUMN email_verified_at timestamptz;
UPDATE accounts SET email_verified_at = created_at;
ALTER TABLE accounts ADD COLUMN terms_version text;
ALTER TABLE accounts ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE accounts ADD COLUMN privacy_accepted_at timestamptz;
CREATE TABLE email_verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX email_verifications_account ON email_verifications(account_id);
`,
  },
  {
    version: "0009_billing",
    sql: `
-- Entitlements (2026-10-22, ADR-0004): one free audit per self-serve account, then a paid credit or the Pro plan. The
-- processor is the source of truth; these columns mirror its notifications (vendor-free names). payment_events makes a
-- notification idempotent: an event id is applied once.
ALTER TABLE accounts ADD COLUMN free_audit_used_at timestamptz;
ALTER TABLE accounts ADD COLUMN audit_credits integer NOT NULL DEFAULT 0 CHECK (audit_credits >= 0);
ALTER TABLE accounts ADD COLUMN plan text NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO'));
ALTER TABLE accounts ADD COLUMN payment_customer_id text UNIQUE;
ALTER TABLE accounts ADD COLUMN payment_subscription_id text;
ALTER TABLE accounts ADD COLUMN subscription_status text;
ALTER TABLE accounts ADD COLUMN current_period_end timestamptz;
CREATE TABLE payment_events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    version: "0010_preflight_events",
    sql: `
-- The pre-flight's outcomes (ADR-0005): what reached the engine, what was refused for nothing, what was reused. A refused or
-- reused file is an engine run avoided; the metrics count them per tenant.
CREATE TABLE preflight_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  outcome    text NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'reused')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX preflight_events_account ON preflight_events(account_id, created_at DESC);
`,
  },
  {
    version: "0011_analysis_billing",
    sql: `
-- What paid for an analysis (free audit, credit, Pro, exempt), so a run that FAILS gives its audit back exactly once
-- ('free' → 'free-refunded').
ALTER TABLE analyses ADD COLUMN billed_via text;
`,
  },
  {
    version: "0012_organisation",
    sql: `
-- ADR-0007: libraries > collections > folders (one level) > files, and tags (per owner). Containers cascade with their
-- owner; a document's placement is NO ACTION, so a container that still holds files cannot disappear by accident.
CREATE TABLE libraries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
CREATE TABLE collections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id uuid NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (library_id, name)
);
CREATE TABLE folders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, name)
);
CREATE TABLE tags (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name     text NOT NULL,
  color    text NOT NULL CHECK (color IN ('blue', 'green', 'amber', 'red', 'violet', 'gray'))
);
CREATE UNIQUE INDEX tags_owner_name ON tags(owner_id, lower(name));
CREATE TABLE collection_tags (collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (collection_id, tag_id));
CREATE TABLE folder_tags (folder_id uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (folder_id, tag_id));
CREATE TABLE document_tags (document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE, tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (document_id, tag_id));
ALTER TABLE documents ADD COLUMN collection_id uuid REFERENCES collections(id);
ALTER TABLE documents ADD COLUMN folder_id uuid REFERENCES folders(id);
ALTER TABLE documents ADD CONSTRAINT documents_folder_in_collection CHECK (folder_id IS NULL OR collection_id IS NOT NULL);
CREATE INDEX documents_collection ON documents(collection_id, folder_id);
`,
  },
  {
    version: "0013_document_storage",
    sql: `
-- ADR-0007: where a document lives (the DocumentStore adapter that holds it) and, when the person or the workspace set one,
-- when it is purged. Every existing document is in the database.
ALTER TABLE documents ADD COLUMN storage text NOT NULL DEFAULT 'database' CHECK (storage IN ('none', 'database', 'bunny', 's3', 'device'));
ALTER TABLE documents ADD COLUMN retain_until timestamptz;
`,
  },
  {
    version: "0014_account_profile",
    sql: `
-- ADR-0008: what the account port needs and no more — a display name, an avatar seed, and the e-mail change (a link mailed to the NEW address).
ALTER TABLE accounts ADD COLUMN name text CHECK (name IS NULL OR char_length(name) <= 80);
ALTER TABLE accounts ADD COLUMN avatar_seed text CHECK (avatar_seed IS NULL OR avatar_seed ~ '^[a-z0-9-]{1,40}$');
CREATE TABLE email_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  new_email  text NOT NULL CHECK (new_email = lower(new_email)),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
`,
  },
  {
    version: "0015_storage_settings",
    sql: `
-- ADR-0007: where a workspace's (today: an owner's) kept documents live — Krizaka's configured store, nothing kept, or its own
-- S3-compatible cloud (the secret is sealed with the deployment's key, never stored or returned in clear).
-- Which cloud holds a document kept outside the database: Krizaka's configured store or the owner's own.
ALTER TABLE documents ADD COLUMN storage_owner text NOT NULL DEFAULT 'krizaka' CHECK (storage_owner IN ('krizaka', 'workspace'));
CREATE TABLE storage_settings (
  owner_id         uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  mode             text NOT NULL DEFAULT 'krizaka' CHECK (mode IN ('none', 'krizaka', 's3')),
  keep_default     boolean NOT NULL DEFAULT false,
  s3_endpoint      text,
  s3_region        text,
  s3_bucket        text,
  s3_access_key_id text,
  s3_secret_sealed text,
  tested_at        timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    version: "0016_app_settings",
    sql: `
-- ADR-0009: the app's configuration as data. A value is set at the global level, for a workspace or for one user; the most
-- specific wins. Every change keeps its before and after.
CREATE TABLE app_settings (
  scope      text NOT NULL CHECK (scope IN ('global', 'workspace', 'user')),
  scope_id   text NOT NULL DEFAULT '',
  key        text NOT NULL CHECK (key ~ '^[a-zA-Z0-9.]{1,80}$'),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (scope, scope_id, key),
  CHECK ((scope = 'global') = (scope_id = ''))
);
CREATE TABLE settings_audit (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_label text NOT NULL,
  scope       text NOT NULL,
  scope_id    text NOT NULL DEFAULT '',
  key         text NOT NULL,
  before      jsonb,
  after       jsonb
);
CREATE INDEX settings_audit_key ON settings_audit(key, id DESC);
`,
  },
  {
    version: "0017_text_source",
    sql: `
-- ADR-0010: a document made from photos keeps how its text was read (local character recognition, or a model's reading with its
-- run), and where the photo came from (device, editor, dates, GPS yes/no). Null for a PDF or a text file.
ALTER TABLE documents ADD COLUMN text_source jsonb;
`,
  },
  { version: "0019_default_collection", sql: DEFAULT_COLLECTION_MIGRATION },
  {
    version: "0020_collection_avatar",
    sql: `
-- krizaka/yomizaka#206: a collection has an avatar — {"kind":"set","seed":"plain-2"} or {"kind":"image","version":3}; null for none.
ALTER TABLE collections ADD COLUMN avatar jsonb CHECK (avatar IS NULL OR (jsonb_typeof(avatar) = 'object' AND avatar->>'kind' IN ('set', 'image')));
`,
  },
  {
    version: "0021_api_keys",
    sql: `
-- ADR-0011: API keys. Only a SHA-256 of the secret is kept; the public id finds the record. A rotated-out key keeps working until
-- superseded_at (its grace period); a revoked one stops at once.
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY,
  owner_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  public_id       text NOT NULL UNIQUE CHECK (public_id ~ '^[0-9a-f]{12}$'),
  secret_hash     text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes          text[] NOT NULL CHECK (cardinality(scopes) > 0),
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  rotated_from_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  superseded_at   timestamptz
);
CREATE INDEX api_keys_owner ON api_keys(owner_id, created_at);
`,
  },
  {
    version: "0022_organize_package",
    sql: `
-- krizaka/yomizaka (ADR-006): the collections' tag join table takes the package's name, and a collection may have a description.
ALTER TABLE collection_tags RENAME TO collections_tags;
ALTER TABLE collections ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 500);
`,
  },
  {
    version: "0023_accounts_auth_package",
    // @krizaka/auth: what the shared account adapter needs on top of 0014 (name, avatar seed, e-mail changes) — the theme the person chose. Idempotent.
    sql: accountsMigration(),
  },
  {
    version: "0024_word_documents",
    sql: `
-- yomizaka#229: a Word file (.docx) is a document — its text read for the checks, the file examined for authenticity.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_mime_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_mime_type_check CHECK (mime_type IN ('application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
`,
  },
  {
    version: "0025_batches",
    sql: `
-- yomizaka#232: a batch of checks from a CSV. The batch is rows, the source of truth; each item one row of the CSV,
-- the document it stored and the analysis it runs or reuses. Deleting the account, the batch or the document
-- takes the rows with it (the analysis keeps its own lifecycle).
CREATE TABLE batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX batches_owner ON batches(owner_id, created_at DESC);

CREATE TABLE batch_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  line        integer NOT NULL CHECK (line >= 2),
  file_name   text NOT NULL,
  reference   text,
  request     jsonb,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  state       text NOT NULL CHECK (state IN ('pending', 'reused', 'running', 'done', 'failed', 'refused')),
  error       text,
  UNIQUE (batch_id, line)
);
CREATE INDEX batch_items_state ON batch_items(batch_id, state);
`,
  },
  {
    version: "0026_opendocument_text",
    sql: `
-- yomizaka#229: OpenDocument text uses the Word upload and analysis path.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_mime_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_mime_type_check CHECK (mime_type IN ('application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.oasis.opendocument.text'));
`,
  },
  {
    version: "0028_batch_tick",
    sql: `
-- yomizaka#240: a batch advances without anyone looking at it. A batch that waits (the account must pay, the engine is busy)
-- is not tried again before tick_after.
ALTER TABLE batches ADD COLUMN tick_after timestamptz;
CREATE INDEX batches_open ON batches(created_at) WHERE finished_at IS NULL;
`,
  },
  {
    version: "0029_webhooks",
    // yomizaka#241: signed outgoing webhooks (endpoints, one queued delivery per endpoint and event, the log).
    sql: webhooksMigration("accounts"),
  },
  {
    version: "0030_application_consents",
    // yomizaka#131 (Loi 25): consent is recorded per application (a screening) and per purpose, with the notice version shown,
    // the date and the means. A withdrawal sets withdrawn_at (the row stays as the record). A document uploaded for an
    // application is linked to it, so its checks are gated by the application's consent. Erasure of an application
    // is its own status: its personal fields are blanked, its documents and result deleted.
    sql: `
CREATE TABLE application_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id   uuid NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  purpose        text NOT NULL CHECK (purpose IN ('DOCUMENT_CHECK', 'COURT_RECORDS', 'CREDIT')),
  notice_version text NOT NULL CHECK (length(notice_version) BETWEEN 1 AND 40),
  means          text NOT NULL CHECK (means IN ('web-form')),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz
);
-- At most one active consent per application and purpose; a withdrawn one is kept as the record.
CREATE UNIQUE INDEX application_consents_active ON application_consents(screening_id, purpose) WHERE withdrawn_at IS NULL;

ALTER TABLE documents ADD COLUMN screening_id uuid REFERENCES screenings(id) ON DELETE SET NULL;
CREATE INDEX documents_screening ON documents(screening_id) WHERE screening_id IS NOT NULL;

ALTER TABLE screenings DROP CONSTRAINT IF EXISTS screenings_status_check;
ALTER TABLE screenings ADD CONSTRAINT screenings_status_check CHECK (status IN ('requested', 'consented', 'shared', 'declined', 'contested', 'expired', 'erased'));`,
  },
  {
    version: "0031_applicant_file",
    // yomizaka#127: the applicant file. A manager asks for a file (a screening row with flow 'file', its link and the document
    // types asked for); the applicant consents per purpose, then uploads. Document types and retention policies are rows: a
    // new type needs no deploy. The link is revoked, used (submitted) or closed (the manager's decision); its files are purged
    // after the check, or after the decision when the applicant consented to keep them (DOCUMENT_KEEP).
    sql: `
CREATE TABLE retention_policies (
  id       text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  purge_on text NOT NULL CHECK (purge_on IN ('after-check', 'after-decision'))
);
INSERT INTO retention_policies (id, purge_on) VALUES ('after-check', 'after-check'), ('after-decision', 'after-decision');

CREATE TABLE document_types (
  id               text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,40}$'),
  accepted_kinds   text[] NOT NULL DEFAULT '{pdf}' CHECK (accepted_kinds <@ ARRAY['pdf']::text[]),
  studios          text[] NOT NULL DEFAULT '{document-authenticity,compliance-check}' CHECK (studios <@ ARRAY['document-authenticity', 'compliance-check']::text[]),
  fields           text[] NOT NULL DEFAULT '{}',
  retention_policy text NOT NULL DEFAULT 'after-check' REFERENCES retention_policies(id),
  active           boolean NOT NULL DEFAULT true,
  position         integer NOT NULL DEFAULT 0
);
INSERT INTO document_types (id, fields, retention_policy, position) VALUES
  ('pay-stub', '{employer,pay-period}', 'after-decision', 1),
  ('bank-statement', '{statement-period}', 'after-decision', 2),
  ('employment-letter', '{employer,position,start-date}', 'after-decision', 3),
  ('identity-document', '{full-name}', 'after-check', 4);

-- The applicant may keep a document until the manager's decision (a consent, with the notice version, like the others).
ALTER TABLE application_consents DROP CONSTRAINT IF EXISTS application_consents_purpose_check;
ALTER TABLE application_consents ADD CONSTRAINT application_consents_purpose_check CHECK (purpose IN ('DOCUMENT_CHECK', 'COURT_RECORDS', 'CREDIT', 'DOCUMENT_KEEP'));

ALTER TABLE screenings ADD COLUMN flow text NOT NULL DEFAULT 'screening' CHECK (flow IN ('screening', 'file'));
ALTER TABLE screenings ADD COLUMN requested_types text[] NOT NULL DEFAULT '{}';
ALTER TABLE screenings ADD COLUMN revoked_at timestamptz;
ALTER TABLE screenings ADD COLUMN submitted_at timestamptz;
ALTER TABLE screenings ADD COLUMN closed_at timestamptz;

ALTER TABLE documents ADD COLUMN document_type text REFERENCES document_types(id);
ALTER TABLE documents ADD COLUMN retention_policy text REFERENCES retention_policies(id);
ALTER TABLE documents ADD COLUMN checks_skipped jsonb NOT NULL DEFAULT '[]';
`,
  },
  {
    version: "0032_password_resets",
    // @krizaka/auth 0.5: the table of password reset links (a link mailed to the account's address, used once, time-limited). Idempotent.
    sql: accountsMigration(),
  },
  {
    version: "0033_workspace_organised",
    // krizaka-ts ADR-003, @krizaka/organize 0.4 (yomizaka#324): tags with markers, the decision set, saved views; the documents' tags move in.
    sql: WORKSPACE_MIGRATION,
  },
  {
    version: "0034_price_catalogue",
    // ADR-009 (krizaka/.github#253, yomizaka#367): the price versions an administrator schedules (@krizaka/settings 0.2, idempotent),
    // and what a subscription was sold at — the catalogue entry and its version, recorded at checkout and kept when it starts.
    sql: `${pricesMigration()}
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS checkout_price_key text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS checkout_price_version text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_price_key text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_price_version text;
`,
  },
  {
    version: "0035_document_extraction",
    // yomizaka#21: a new document's text is read after the upload answered (202 Accepted). Every existing row is already read: `done`.
    sql: `ALTER TABLE documents ADD COLUMN extraction text NOT NULL DEFAULT 'done' CHECK (extraction IN ('queued', 'running', 'done', 'failed'));
ALTER TABLE documents ADD COLUMN extraction_error text;
ALTER TABLE documents ADD COLUMN extraction_at timestamptz NOT NULL DEFAULT now();
`,
  },
  {
    version: "0036_adopt_krizaka_modules",
    // krizaka-ts ADR-001 (yomizaka#258): the tables of settings (0016), prices (0034), accounts (0023), API keys (0021), webhooks (0029) and
    // the organised workspace (0033) ran before `@krizaka/db`. Their versions are adopted: markers only, no DDL. Printed by `adoptMigration`
    // (`lib/modules.ts`); `lib/modules.test.ts` holds this text to what it prints today.
    sql: `-- @krizaka/db: adopt settings v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('settings', 1, '051524285802ef38f829227d81f34935afd8999c2f83be821d25b1f6078ac7a1')
ON CONFLICT (module, version) DO NOTHING;

-- @krizaka/db: adopt settings_prices v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('settings_prices', 1, 'a2cad37a2efe0309a4114b7bfe67fa5fc9766d7a5d3aba4e1edbc4157125c11f')
ON CONFLICT (module, version) DO NOTHING;

-- @krizaka/db: adopt auth v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('auth', 1, 'a48bf5bf2db6f001d588c012447f75ea8fd3d57f049debd1ba1de801dc037628')
ON CONFLICT (module, version) DO NOTHING;

-- @krizaka/db: adopt api_keys v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('api_keys', 1, '65a8c2cee01432a016cb553fb8f9765e39a9fe51f1ad30bfab7693120a65ac20')
ON CONFLICT (module, version) DO NOTHING;

-- @krizaka/db: adopt webhooks v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('webhooks', 1, 'f7850a9284262b6daffebc41540647ccae5cc6ea7842fdd765fbf3b483d751e9')
ON CONFLICT (module, version) DO NOTHING;

-- @krizaka/db: adopt organize_workspace v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('organize_workspace', 1, '40aad1cd1db0f5cf96e43a4015934b9c633b8b993d58f3ff7273319fc0bf6a6b')
ON CONFLICT (module, version) DO NOTHING;
`,
  },
  {
    version: "0037_audit_package",
    // krizaka-ts `@krizaka/audit` v1 (printed by `emitMigration`, `lib/modules.ts` EMITTED; `lib/modules.test.ts` holds this text to it), then the copy of `audit_log`.
    sql: `-- @krizaka/db: audit v1 (entries). Generated by emitMigration; never edit by hand.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
CREATE SCHEMA IF NOT EXISTS audit;
CREATE TABLE audit.entry (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  actor_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  actor_label text NOT NULL CHECK (char_length(actor_label) BETWEEN 1 AND 120),
  action      text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$' AND char_length(action) <= 80),
  target_type text CHECK (target_type IS NULL OR char_length(target_type) <= 40),
  target_id   text CHECK (target_id IS NULL OR char_length(target_id) <= 200),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet
);
CREATE INDEX entry_at ON audit.entry (at DESC);
CREATE INDEX entry_action ON audit.entry (action, at DESC);
CREATE INDEX entry_target ON audit.entry (target_type, target_id, at DESC);
CREATE INDEX entry_actor ON audit.entry (actor_id) WHERE actor_id IS NOT NULL;
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('audit', 1, '0a4bb651cf3e6b34f99bc29b22944e7ef7da1a1ce28df02807b45ca51cbf722d')
ON CONFLICT (module, version) DO NOTHING;

-- yomizaka#259: the trail moves into the package's table. Every row is copied in order (an action id takes the package's alphabet: « applicant-file.closed » is
-- « applicant_file.closed »; a label is cut to 120; an actor that no longer exists is null; a target is typed by its action's domain), the counts must match,
-- then \`audit_log\` stays one release as a view over the table (a rollback of the code still writes and reads it) and is dropped in a follow-up.
CREATE FUNCTION pg_temp.audit_inet(v text) RETURNS inet LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN v::inet;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
INSERT INTO audit.entry (at, actor_id, actor_label, action, target_type, target_id, detail, ip)
SELECT l.at, a.id, left(coalesce(nullif(btrim(l.actor_label), ''), 'unknown'), 120), left(regexp_replace(lower(l.action), '[^a-z0-9_.]', '_', 'g'), 80),
       CASE WHEN l.target_id IS NULL THEN NULL ELSE left(split_part(regexp_replace(lower(l.action), '[^a-z0-9_.]', '_', 'g'), '.', 1), 40) END,
       left(l.target_id, 200), l.detail, pg_temp.audit_inet(l.ip)
  FROM audit_log l LEFT JOIN accounts a ON a.id = l.actor_id
 ORDER BY l.id;
DO $$
BEGIN
  IF (SELECT count(*) FROM audit.entry) <> (SELECT count(*) FROM audit_log) THEN
    RAISE EXCEPTION 'audit copy: the row counts differ';
  END IF;
END $$;
DROP TABLE audit_log;
CREATE VIEW audit_log AS SELECT id, at, actor_id, actor_label, action, target_id, detail, ip FROM audit.entry;
ALTER VIEW audit_log ALTER COLUMN at SET DEFAULT now();
`,
  },
  {
    version: "0038_adopt_sessions",
    // yomizaka#263: the `sessions` table (0001) is `@krizaka/auth`'s `auth_sessions` v1: adopted, markers only, no DDL. The tokens and hashes stored stay valid.
    sql: `-- @krizaka/db: adopt auth_sessions v1–v1 (existing tables, markers only). Generated by adoptMigration.
CREATE TABLE IF NOT EXISTS public.krizaka_module_versions (
  module     text NOT NULL,
  version    integer NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, version)
);
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES
  ('auth_sessions', 1, '25ebd4e197a9af3c91386dd4142abcb58c58aac7142bfe4fb18efa2a282f8421')
ON CONFLICT (module, version) DO NOTHING;
`,
  },
  {
    version: "0039_screening_providers",
    // yomizaka#132: the screening providers, the check types and what each owner may request are DATA. A provider row names an
    // adapter (demo, or the engine's door); a check type names a provider and the engine purpose it needs, its labels, its price
    // as cost + margin, and the consent notice version. Adding a type or switching a provider is a row, no deploy.
    // screening_checks keeps one check's honest outcome: a closed outcome, the provider's opaque reference and the engine run id —
    // never a raw report (yomizaka#134).
    sql: `
CREATE TABLE screening_provider (
  id       text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  adapter  text NOT NULL CHECK (adapter IN ('demo', 'engine')),
  label    text NOT NULL,
  region   text NOT NULL DEFAULT 'CA',
  enabled  boolean NOT NULL DEFAULT false,
  note     text
);
CREATE TABLE check_type (
  key                    text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9-]{1,39}$'),
  provider_id            text NOT NULL REFERENCES screening_provider(id),
  purpose                text NOT NULL CHECK (purpose IN ('COURT_RECORDS', 'CREDIT')),
  label_fr               text NOT NULL,
  label_en               text NOT NULL,
  provider_cost_cents    integer NOT NULL DEFAULT 0 CHECK (provider_cost_cents >= 0),
  margin_cents           integer NOT NULL DEFAULT 0 CHECK (margin_cents >= 0),
  currency               text NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  region                 text NOT NULL DEFAULT 'QC',
  consent_notice_version text NOT NULL,
  enabled                boolean NOT NULL DEFAULT false,
  default_on             boolean NOT NULL DEFAULT false,
  requires_lawyer        text,
  note                   text
);
CREATE TABLE tenant_check_setting (
  owner_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  check_type text NOT NULL REFERENCES check_type(key),
  allowed    boolean NOT NULL,
  PRIMARY KEY (owner_id, check_type)
);
CREATE TABLE screening_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id uuid NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  check_type   text NOT NULL REFERENCES check_type(key),
  state        text NOT NULL CHECK (state IN ('answered', 'pending', 'unavailable', 'soon')),
  outcome      text NOT NULL CHECK (outcome IN ('MATCH', 'NO_MATCH', 'PENDING', 'PROVIDER_ERROR', 'TIMEOUT', 'REFUSED')),
  refusal      text CHECK (refusal IN ('NO_CONSENT', 'NO_KEY', 'BUDGET_EXHAUSTED', 'NOT_CONFIGURED')),
  category     text NOT NULL DEFAULT 'NONE' CHECK (category IN ('TAL_NON_PAYMENT', 'TAL_OTHER', 'CRIMINAL', 'CIVIL', 'NONE')),
  provider_ref text,
  run_id       uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz,
  UNIQUE (screening_id, check_type)
);
INSERT INTO screening_provider (id, adapter, label, enabled, note) VALUES
  ('demo', 'demo', 'Demonstration', true, 'Fictitious data, deterministic.'),
  ('engine', 'engine', 'Orazaka external checks', true, 'Routes to the vendors by data. Every call answers NOT_CONFIGURED until a provider account exists and the compliance gate is open.');
INSERT INTO check_type (key, provider_id, purpose, label_fr, label_en, consent_notice_version, enabled, default_on, requires_lawyer, note) VALUES
  ('payment-history', 'demo', 'COURT_RECORDS', 'Historique de paiement', 'Payment history', '2026-10-24.2', true, true, NULL, 'Demonstration only until a provider agreement is signed.'),
  ('credit', 'engine', 'CREDIT', 'Rapport de crédit', 'Credit report', '2026-10-24.2', true, false, NULL, 'Price to be set when the provider agreement is signed. Offered to an owner by a tenant_check_setting row.'),
  ('criminal-record', 'engine', 'COURT_RECORDS', 'Antécédents judiciaires', 'Criminal record', '2026-10-24.2', false, false, 'criminal-records-lawful', 'OFF. Not offered to Québec landlords until a lawyer confirms it is lawful for rental (Charter, CDPDJ).');`,
  },
  {
    version: "0040_screening_polling",
    // yomizaka#134: a PENDING check is collected by polling its provider (webhooks later, yomizaka#426). The interval and the number of
    // tries are DATA on the provider row; a check that never answers is given up as « unavailable », never kept pending for good.
    sql: `
ALTER TABLE screening_provider ADD COLUMN poll_minutes integer NOT NULL DEFAULT 15 CHECK (poll_minutes BETWEEN 1 AND 1440);
ALTER TABLE screening_provider ADD COLUMN poll_max integer NOT NULL DEFAULT 96 CHECK (poll_max BETWEEN 1 AND 1000);
ALTER TABLE screening_checks ADD COLUMN next_poll_at timestamptz;
ALTER TABLE screening_checks ADD COLUMN polls integer NOT NULL DEFAULT 0;
CREATE INDEX screening_checks_due ON screening_checks(next_poll_at) WHERE state = 'pending';`,
  },
  {
    version: "0041_screening_charges",
    // yomizaka#133: per-check billing. The payer is chosen per request (the applicant pays only where the check type allows it:
    // C.c.Q. art. 1904 limits the fees a tenant may be charged, a lawyer decides). A charge snapshots cost + margin and the invoice
    // line, so a later price change never rewrites what was billed. Nothing is written while features.screeningBilling is off.
    sql: `
ALTER TABLE screenings ADD COLUMN payer text NOT NULL DEFAULT 'owner' CHECK (payer IN ('firm', 'owner', 'applicant'));
ALTER TABLE check_type ADD COLUMN applicant_may_pay boolean NOT NULL DEFAULT false;
CREATE TABLE screening_charge (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id        uuid NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  check_type          text NOT NULL REFERENCES check_type(key),
  payer               text NOT NULL CHECK (payer IN ('firm', 'owner', 'applicant')),
  provider_cost_cents integer NOT NULL CHECK (provider_cost_cents >= 0),
  margin_cents        integer NOT NULL CHECK (margin_cents >= 0),
  amount_cents        integer NOT NULL CHECK (amount_cents = provider_cost_cents + margin_cents),
  currency            text NOT NULL DEFAULT 'CAD',
  description         text NOT NULL,
  state               text NOT NULL CHECK (state IN ('charged', 'refunded', 'failed')),
  charge_ref          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  refunded_at         timestamptz,
  UNIQUE (screening_id, check_type)
);`,
  },
];
