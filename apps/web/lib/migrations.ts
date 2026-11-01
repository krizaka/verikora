/**
 * The schema, as ordered migrations applied once each (lib/db.ts `migrate`, at server start, under an advisory lock).
 * Kept in code rather than in .sql files so the standalone server carries them.
 *
 * ONE baseline (krizaka-internal#2044, founder 2026-10-31: no production yet, so no history to keep): the schema of the
 * 65 migrations before it, with the Krizaka modules' version markers. The config rows (document types, retention,
 * screening providers, check types, compliance gates) are NOT here: they are seeded from code, `lib/config-seed.ts`.
 * A change of schema from now on is a NEW entry after this one; regenerate the baseline only by rebuilding a dev database.
 */
export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: "0001_baseline",
    sql: String.raw`
CREATE SCHEMA audit;

CREATE SCHEMA coupons;

CREATE SCHEMA credits;

CREATE SCHEMA organize;

CREATE SCHEMA payments;

CREATE SCHEMA privacy;

CREATE SCHEMA storage;

CREATE FUNCTION credits.entry_is_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'credits.entry is append-only: % refused', TG_OP;
END;
$$;

CREATE FUNCTION privacy.consent_written_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'a consent is written once: a withdrawal is a new row' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION privacy.incident_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.retain_until > now() THEN
      RAISE EXCEPTION 'an incident stays in the register until its retention ends' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'a closed entry of the register is never edited' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.scope <> OLD.scope THEN
    RAISE EXCEPTION 'an incident never changes register' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.accounts_default_collection() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM create_default_collection(NEW.id, NEW.locale);
  RETURN NEW;
END
$$;

CREATE FUNCTION public.collections_exactly_one_default() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE o uuid := COALESCE(NEW.owner_id, OLD.owner_id);
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE id = o) AND (SELECT count(*) FROM collections WHERE owner_id = o AND is_default) <> 1 THEN
    RAISE EXCEPTION 'DEFAULT_COLLECTION: an account has exactly one default collection';
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION public.collections_fill_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  SELECT owner_id INTO NEW.owner_id FROM libraries WHERE id = NEW.library_id;
  RETURN NEW;
END
$$;

CREATE FUNCTION public.collections_guard_default() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.is_default AND EXISTS (SELECT 1 FROM accounts WHERE id = OLD.owner_id) THEN
    RAISE EXCEPTION 'DEFAULT_COLLECTION: the default collection cannot be deleted';
  END IF;
  RETURN OLD;
END
$$;

CREATE FUNCTION public.create_default_collection(p_owner uuid, p_locale text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  lib uuid;
  col uuid;
  base text := CASE p_locale WHEN 'fr' THEN 'Mes documents' ELSE 'My documents' END;
  candidate text;
  n int := 1;
BEGIN
  SELECT id INTO lib FROM libraries WHERE owner_id = p_owner ORDER BY created_at, id LIMIT 1;
  IF lib IS NULL THEN
    INSERT INTO libraries (owner_id, name) VALUES (p_owner, CASE p_locale WHEN 'fr' THEN 'Ma bibliothèque' ELSE 'My library' END) RETURNING id INTO lib;
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM collections WHERE library_id = lib AND name = candidate) LOOP
    n := n + 1;
    candidate := base || ' ' || n;
  END LOOP;
  INSERT INTO collections (library_id, owner_id, name, is_default) VALUES (lib, p_owner, candidate, true) RETURNING id INTO col;
  RETURN col;
END
$$;

CREATE FUNCTION public.documents_default_collection() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.collection_id IS NULL THEN
    SELECT id INTO NEW.collection_id FROM collections WHERE owner_id = NEW.owner_id AND is_default;
    NEW.folder_id := NULL;
  END IF;
  RETURN NEW;
END
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE audit.entry (
    id bigint NOT NULL,
    at timestamp with time zone NOT NULL,
    actor_id uuid,
    actor_label text NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip inet,
    CONSTRAINT entry_action_check CHECK (((action ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'::text) AND (char_length(action) <= 80))),
    CONSTRAINT entry_actor_label_check CHECK (((char_length(actor_label) >= 1) AND (char_length(actor_label) <= 120))),
    CONSTRAINT entry_target_id_check CHECK (((target_id IS NULL) OR (char_length(target_id) <= 200))),
    CONSTRAINT entry_target_type_check CHECK (((target_type IS NULL) OR (char_length(target_type) <= 40)))
);

CREATE SEQUENCE audit.entry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE audit.entry_id_seq OWNED BY audit.entry.id;

CREATE TABLE coupons.coupon (
    id uuid NOT NULL,
    code text NOT NULL,
    code_key text NOT NULL,
    kind text NOT NULL,
    purpose text NOT NULL,
    partner_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    max_redemptions integer,
    max_per_account integer DEFAULT 1 NOT NULL,
    new_customers_only boolean DEFAULT false NOT NULL,
    plans text[] DEFAULT '{}'::text[] NOT NULL,
    percent_off_bp integer,
    amount_off_minor integer,
    currency text,
    duration text,
    duration_months integer,
    minimum_minor integer,
    credits integer,
    cap_per_day integer,
    cap_per_month integer,
    credits_valid_days integer,
    on_exhausted text,
    terms_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT coupon_amount_off_minor_check CHECK ((amount_off_minor > 0)),
    CONSTRAINT coupon_cap_per_day_check CHECK ((cap_per_day > 0)),
    CONSTRAINT coupon_cap_per_month_check CHECK ((cap_per_month > 0)),
    CONSTRAINT coupon_check CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT coupon_check1 CHECK (((purpose = 'partner'::text) = (partner_id IS NOT NULL))),
    CONSTRAINT coupon_check2 CHECK (((kind <> 'discount'::text) OR ((credits IS NULL) AND (num_nonnulls(percent_off_bp, amount_off_minor) = 1) AND ((amount_off_minor IS NULL) OR (currency IS NOT NULL)) AND (duration IS NOT NULL) AND ((duration = 'repeating'::text) = (duration_months IS NOT NULL)) AND ((amount_off_minor IS NULL) OR (duration <> 'forever'::text))))),
    CONSTRAINT coupon_check3 CHECK (((kind <> 'credit'::text) OR ((credits IS NOT NULL) AND (on_exhausted IS NOT NULL) AND (credits_valid_days IS NOT NULL) AND (num_nulls(percent_off_bp, amount_off_minor, duration) = 3)))),
    CONSTRAINT coupon_code_check CHECK (((char_length(code) >= 4) AND (char_length(code) <= 60))),
    CONSTRAINT coupon_code_key_check CHECK (((code_key = upper(code_key)) AND ((char_length(code_key) >= 4) AND (char_length(code_key) <= 40)))),
    CONSTRAINT coupon_credits_check CHECK ((credits > 0)),
    CONSTRAINT coupon_credits_valid_days_check CHECK ((credits_valid_days > 0)),
    CONSTRAINT coupon_currency_check CHECK ((currency ~ '^[a-z]{3}$'::text)),
    CONSTRAINT coupon_duration_check CHECK ((duration = ANY (ARRAY['once'::text, 'repeating'::text, 'forever'::text]))),
    CONSTRAINT coupon_duration_months_check CHECK (((duration_months >= 1) AND (duration_months <= 36))),
    CONSTRAINT coupon_kind_check CHECK ((kind = ANY (ARRAY['discount'::text, 'credit'::text]))),
    CONSTRAINT coupon_max_per_account_check CHECK ((max_per_account > 0)),
    CONSTRAINT coupon_max_redemptions_check CHECK ((max_redemptions > 0)),
    CONSTRAINT coupon_minimum_minor_check CHECK ((minimum_minor >= 0)),
    CONSTRAINT coupon_on_exhausted_check CHECK ((on_exhausted = ANY (ARRAY['stop'::text, 'fallback_paid'::text]))),
    CONSTRAINT coupon_percent_off_bp_check CHECK (((percent_off_bp >= 1) AND (percent_off_bp <= 9999))),
    CONSTRAINT coupon_purpose_check CHECK ((purpose = ANY (ARRAY['partner'::text, 'promo'::text, 'demo'::text, 'support'::text]))),
    CONSTRAINT coupon_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])))
);

CREATE TABLE coupons.partner (
    id uuid NOT NULL,
    display_name text,
    contact_email text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid,
    erased_at timestamp with time zone,
    CONSTRAINT partner_check CHECK (((erased_at IS NOT NULL) OR (display_name IS NOT NULL))),
    CONSTRAINT partner_check1 CHECK (((erased_at IS NULL) OR ((display_name IS NULL) AND (contact_email IS NULL)))),
    CONSTRAINT partner_contact_email_check CHECK (((contact_email IS NULL) OR (contact_email = lower(contact_email)))),
    CONSTRAINT partner_display_name_check CHECK (((display_name IS NULL) OR ((char_length(display_name) >= 1) AND (char_length(display_name) <= 80)))),
    CONSTRAINT partner_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);

CREATE TABLE coupons.redemption (
    id uuid NOT NULL,
    coupon_id uuid NOT NULL,
    account_id uuid,
    partner_id uuid,
    status text NOT NULL,
    idempotency_key text NOT NULL,
    reserved_until timestamp with time zone,
    checkout_ref text,
    payment_ref text,
    amount_paid_minor bigint,
    amount_discount_minor bigint,
    amount_refunded_minor bigint DEFAULT 0 NOT NULL,
    use_restored boolean DEFAULT false NOT NULL,
    currency text,
    credit_grant_id uuid,
    over_limit boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    ended_at timestamp with time zone,
    CONSTRAINT redemption_amount_refunded_minor_check CHECK ((amount_refunded_minor >= 0)),
    CONSTRAINT redemption_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'confirmed'::text, 'released'::text, 'revoked'::text])))
);

CREATE TABLE credits.entry (
    seq bigint NOT NULL,
    id uuid NOT NULL,
    account_id uuid NOT NULL,
    grant_id uuid,
    type text NOT NULL,
    amount bigint NOT NULL,
    reason text NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    reverses text,
    hold_id uuid,
    at timestamp with time zone NOT NULL,
    CONSTRAINT entry_check CHECK (((amount <> 0) OR (type = 'EXPIRY'::text))),
    CONSTRAINT entry_reason_check CHECK (((char_length(reason) >= 1) AND (char_length(reason) <= 300))),
    CONSTRAINT entry_type_check CHECK ((type = ANY (ARRAY['GRANT'::text, 'PURCHASE'::text, 'DEBIT'::text, 'REFUND'::text, 'EXPIRY'::text, 'ADJUSTMENT'::text])))
);

ALTER TABLE credits.entry ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME credits.entry_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE credits."grant" (
    id uuid NOT NULL,
    account_id uuid NOT NULL,
    bucket text NOT NULL,
    amount bigint NOT NULL,
    cap_per_day bigint,
    cap_per_month bigint,
    expires_at timestamp with time zone,
    on_exhausted text NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT grant_amount_check CHECK ((amount > 0)),
    CONSTRAINT grant_bucket_check CHECK ((bucket = ANY (ARRAY['granted'::text, 'purchased'::text]))),
    CONSTRAINT grant_cap_per_day_check CHECK (((cap_per_day IS NULL) OR (cap_per_day > 0))),
    CONSTRAINT grant_cap_per_month_check CHECK (((cap_per_month IS NULL) OR (cap_per_month > 0))),
    CONSTRAINT grant_check CHECK ((((bucket = 'granted'::text) AND (expires_at IS NOT NULL)) OR ((bucket = 'purchased'::text) AND (expires_at IS NULL) AND (cap_per_day IS NULL) AND (cap_per_month IS NULL)))),
    CONSTRAINT grant_on_exhausted_check CHECK ((on_exhausted = ANY (ARRAY['stop'::text, 'fallback_paid'::text]))),
    CONSTRAINT grant_source_check CHECK (((char_length(source) >= 1) AND (char_length(source) <= 200)))
);

CREATE TABLE credits.hold (
    id uuid NOT NULL,
    account_id uuid NOT NULL,
    amount bigint NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text NOT NULL,
    settled_amount bigint,
    created_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    operation text NOT NULL,
    CONSTRAINT hold_amount_check CHECK ((amount > 0)),
    CONSTRAINT hold_settled_amount_check CHECK (((settled_amount IS NULL) OR (settled_amount >= 0))),
    CONSTRAINT hold_status_check CHECK ((status = ANY (ARRAY['active'::text, 'settled'::text, 'released'::text])))
);

CREATE TABLE organize.applicant_file_status (
    entity_id uuid NOT NULL,
    state text NOT NULL,
    changed_at timestamp with time zone NOT NULL,
    changed_by uuid,
    CONSTRAINT applicant_file_status_state_check CHECK ((state ~ '^[a-z][a-z0-9_]{0,39}$'::text))
);

CREATE TABLE organize.applicant_file_tag (
    entity_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    kind text DEFAULT 'applicant_file'::text NOT NULL,
    CONSTRAINT applicant_file_tag_kind_check CHECK ((kind = 'applicant_file'::text))
);

CREATE TABLE organize.document_status (
    entity_id uuid NOT NULL,
    state text NOT NULL,
    changed_at timestamp with time zone NOT NULL,
    changed_by uuid,
    CONSTRAINT document_status_state_check CHECK ((state ~ '^[a-z][a-z0-9_]{0,39}$'::text))
);

CREATE TABLE organize.document_tag (
    entity_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    kind text DEFAULT 'document'::text NOT NULL,
    CONSTRAINT document_tag_kind_check CHECK ((kind = 'document'::text))
);

CREATE TABLE organize.kind_config (
    kind text NOT NULL,
    config jsonb NOT NULL,
    version integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by uuid,
    CONSTRAINT kind_config_config_check CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT kind_config_kind_check CHECK ((kind ~ '^[a-z][a-z0-9_]{0,39}$'::text)),
    CONSTRAINT kind_config_version_check CHECK ((version >= 1))
);

CREATE TABLE organize.tag (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    marker text NOT NULL,
    origin text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT tag_marker_check CHECK ((marker = ANY (ARRAY['blue'::text, 'green'::text, 'amber'::text, 'red'::text, 'violet'::text, 'gray'::text]))),
    CONSTRAINT tag_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
    CONSTRAINT tag_origin_check CHECK ((origin = ANY (ARRAY['preset'::text, 'user'::text])))
);

CREATE TABLE organize.view (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_id uuid NOT NULL,
    kind text NOT NULL,
    author_id uuid NOT NULL,
    name text NOT NULL,
    filters jsonb NOT NULL,
    shared boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT view_filters_check CHECK ((jsonb_typeof(filters) = 'object'::text)),
    CONSTRAINT view_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80)))
);

CREATE TABLE payments.discount (
    coupon_id text NOT NULL,
    terms_version integer NOT NULL,
    provider text NOT NULL,
    provider_ref text NOT NULL,
    CONSTRAINT discount_coupon_id_check CHECK (((char_length(coupon_id) >= 1) AND (char_length(coupon_id) <= 100))),
    CONSTRAINT discount_provider_check CHECK ((provider ~ '^[a-z][a-z0-9_-]{0,39}$'::text)),
    CONSTRAINT discount_terms_version_check CHECK ((terms_version >= 1))
);

CREATE TABLE payments.event (
    id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE privacy.consent (
    seq bigint NOT NULL,
    id uuid NOT NULL,
    subject_kind text NOT NULL,
    subject_id text NOT NULL,
    purpose text NOT NULL,
    version text NOT NULL,
    granted boolean NOT NULL,
    means text,
    at timestamp with time zone NOT NULL,
    CONSTRAINT consent_means_check CHECK (((means IS NULL) OR (char_length(means) <= 40))),
    CONSTRAINT consent_purpose_check CHECK ((purpose ~ '^[a-z][a-z0-9_-]{0,39}$'::text)),
    CONSTRAINT consent_subject_id_check CHECK (((char_length(subject_id) >= 1) AND (char_length(subject_id) <= 200))),
    CONSTRAINT consent_subject_kind_check CHECK ((subject_kind ~ '^[a-z][a-z0-9_]{0,39}$'::text)),
    CONSTRAINT consent_version_check CHECK (((char_length(version) >= 1) AND (char_length(version) <= 100)))
);

CREATE SEQUENCE privacy.consent_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE privacy.consent_seq_seq OWNED BY privacy.consent.seq;

CREATE TABLE privacy.incident (
    id uuid NOT NULL,
    scope text NOT NULL,
    kind text NOT NULL,
    aware_at timestamp with time zone NOT NULL,
    occurred_at timestamp with time zone,
    description text NOT NULL,
    information text[] NOT NULL,
    persons_concerned integer,
    measures jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    assessment jsonb,
    cai_notice jsonb,
    persons_notice jsonb,
    drill boolean DEFAULT false NOT NULL,
    opened_by text NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    retain_until timestamp with time zone NOT NULL,
    CONSTRAINT incident_description_check CHECK (((char_length(description) >= 1) AND (char_length(description) <= 2000))),
    CONSTRAINT incident_information_check CHECK (((cardinality(information) >= 1) AND (cardinality(information) <= 30))),
    CONSTRAINT incident_kind_check CHECK ((kind = ANY (ARRAY['access'::text, 'use'::text, 'communication'::text, 'loss'::text]))),
    CONSTRAINT incident_persons_concerned_check CHECK (((persons_concerned IS NULL) OR (persons_concerned >= 0))),
    CONSTRAINT incident_scope_check CHECK (((char_length(scope) >= 1) AND (char_length(scope) <= 100))),
    CONSTRAINT incident_status_check CHECK ((status = ANY (ARRAY['open'::text, 'assessed'::text, 'closed'::text])))
);

CREATE TABLE privacy.request (
    id uuid NOT NULL,
    subject_kind text NOT NULL,
    subject_id text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    failure text,
    CONSTRAINT request_failure_check CHECK (((failure IS NULL) OR (char_length(failure) <= 100))),
    CONSTRAINT request_kind_check CHECK ((kind = ANY (ARRAY['export'::text, 'erasure'::text]))),
    CONSTRAINT request_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT request_subject_id_check CHECK (((char_length(subject_id) >= 1) AND (char_length(subject_id) <= 200))),
    CONSTRAINT request_subject_kind_check CHECK ((subject_kind ~ '^[a-z][a-z0-9_]{0,39}$'::text))
);

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'USER'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    password_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    perspective text,
    email_verified_at timestamp with time zone,
    terms_version text,
    terms_accepted_at timestamp with time zone,
    privacy_accepted_at timestamp with time zone,
    free_audit_used_at timestamp with time zone,
    audit_credits integer DEFAULT 0 NOT NULL,
    plan text DEFAULT 'FREE'::text NOT NULL,
    payment_customer_id text,
    payment_subscription_id text,
    subscription_status text,
    current_period_end timestamp with time zone,
    name text,
    avatar_seed text,
    theme text,
    checkout_price_key text,
    checkout_price_version text,
    subscription_price_key text,
    subscription_price_version text,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    CONSTRAINT accounts_audit_credits_check CHECK ((audit_credits >= 0)),
    CONSTRAINT accounts_avatar_seed_check CHECK (((avatar_seed IS NULL) OR (avatar_seed ~ '^[a-z0-9-]{1,40}$'::text))),
    CONSTRAINT accounts_email_check CHECK ((email = lower(email))),
    CONSTRAINT accounts_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'fr'::text]))),
    CONSTRAINT accounts_name_check CHECK (((name IS NULL) OR (char_length(name) <= 80))),
    CONSTRAINT accounts_perspective_check CHECK ((perspective = ANY (ARRAY['tenant'::text, 'landlord'::text, 'freelancer'::text, 'business'::text]))),
    CONSTRAINT accounts_plan_check CHECK ((plan = ANY (ARRAY['FREE'::text, 'PRO'::text]))),
    CONSTRAINT accounts_role_check CHECK ((role = ANY (ARRAY['USER'::text, 'ADMIN'::text]))),
    CONSTRAINT accounts_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text]))),
    CONSTRAINT accounts_theme_check CHECK (((theme IS NULL) OR (theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text]))))
);

CREATE TABLE public.analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    studio text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    run_id text,
    blueprint_version text,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    report jsonb,
    error text,
    search_text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    showcase boolean DEFAULT false NOT NULL,
    flow_version_id uuid,
    billed_via text,
    CONSTRAINT analyses_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT analyses_studio_check CHECK ((studio = ANY (ARRAY['compliance-check'::text, 'document-authenticity'::text])))
);

CREATE TABLE public.api_keys (
    id uuid NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    public_id text NOT NULL,
    secret_hash text NOT NULL,
    scopes text[] NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    rotated_from_id uuid,
    superseded_at timestamp with time zone,
    CONSTRAINT api_keys_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
    CONSTRAINT api_keys_public_id_check CHECK ((public_id ~ '^[0-9a-f]{12}$'::text)),
    CONSTRAINT api_keys_scopes_check CHECK ((cardinality(scopes) > 0)),
    CONSTRAINT api_keys_secret_hash_check CHECK ((secret_hash ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE public.app_settings (
    scope text NOT NULL,
    scope_id text DEFAULT ''::text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT app_settings_check CHECK (((scope = 'global'::text) = (scope_id = ''::text))),
    CONSTRAINT app_settings_key_check CHECK ((key ~ '^[a-zA-Z0-9.]{1,80}$'::text)),
    CONSTRAINT app_settings_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'workspace'::text, 'user'::text])))
);

CREATE TABLE public.application_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screening_id uuid NOT NULL,
    purpose text NOT NULL,
    notice_version text NOT NULL,
    means text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    withdrawn_at timestamp with time zone,
    price_cents integer,
    currency text,
    payer text,
    CONSTRAINT application_consents_means_check CHECK ((means = 'web-form'::text)),
    CONSTRAINT application_consents_notice_version_check CHECK (((length(notice_version) >= 1) AND (length(notice_version) <= 40))),
    CONSTRAINT application_consents_payer_check CHECK (((payer IS NULL) OR (payer = ANY (ARRAY['firm'::text, 'owner'::text, 'applicant'::text])))),
    CONSTRAINT application_consents_price_cents_check CHECK (((price_cents IS NULL) OR (price_cents >= 0))),
    CONSTRAINT application_consents_purpose_check CHECK ((purpose = ANY (ARRAY['DOCUMENT_CHECK'::text, 'COURT_RECORDS'::text, 'CREDIT'::text, 'DOCUMENT_KEEP'::text])))
);

CREATE VIEW public.audit_log AS
 SELECT id,
    at,
    actor_id,
    actor_label,
    action,
    target_id,
    detail,
    ip
   FROM audit.entry;

CREATE TABLE public.batch_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    line integer NOT NULL,
    file_name text NOT NULL,
    reference text,
    request jsonb,
    document_id uuid,
    analysis_id uuid,
    state text NOT NULL,
    error text,
    CONSTRAINT batch_items_line_check CHECK ((line >= 2)),
    CONSTRAINT batch_items_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'reused'::text, 'running'::text, 'done'::text, 'failed'::text, 'refused'::text])))
);

CREATE TABLE public.batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    tick_after timestamp with time zone,
    CONSTRAINT batches_name_check CHECK (((length(name) >= 1) AND (length(name) <= 200)))
);

CREATE TABLE public.check_type (
    key text NOT NULL,
    provider_id text NOT NULL,
    purpose text NOT NULL,
    label_fr text NOT NULL,
    label_en text NOT NULL,
    provider_cost_cents integer DEFAULT 0 NOT NULL,
    margin_cents integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CAD'::text NOT NULL,
    region text DEFAULT 'QC'::text NOT NULL,
    consent_notice_version text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    default_on boolean DEFAULT false NOT NULL,
    requires_lawyer text,
    note text,
    applicant_may_pay boolean DEFAULT false NOT NULL,
    CONSTRAINT check_type_currency_check CHECK ((currency = 'CAD'::text)),
    CONSTRAINT check_type_key_check CHECK ((key ~ '^[a-z][a-z0-9-]{1,39}$'::text)),
    CONSTRAINT check_type_margin_cents_check CHECK ((margin_cents >= 0)),
    CONSTRAINT check_type_provider_cost_cents_check CHECK ((provider_cost_cents >= 0)),
    CONSTRAINT check_type_purpose_check CHECK ((purpose = ANY (ARRAY['COURT_RECORDS'::text, 'CREDIT'::text])))
);

CREATE TABLE public.collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_id uuid NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    avatar jsonb,
    description text,
    CONSTRAINT collections_avatar_check CHECK (((avatar IS NULL) OR ((jsonb_typeof(avatar) = 'object'::text) AND ((avatar ->> 'kind'::text) = ANY (ARRAY['set'::text, 'image'::text]))))),
    CONSTRAINT collections_description_check CHECK (((description IS NULL) OR (length(description) <= 500)))
);

CREATE TABLE public.collections_tags (
    collection_id uuid NOT NULL,
    tag_id uuid NOT NULL
);

CREATE TABLE public.compliance_gate (
    blocker text NOT NULL,
    label text NOT NULL,
    required_live boolean DEFAULT true NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    evidence_on date,
    evidence_ref text,
    CONSTRAINT compliance_gate_blocker_check CHECK ((blocker ~ '^[a-z][a-z0-9-]{2,60}$'::text)),
    CONSTRAINT compliance_gate_done_has_evidence CHECK (((status = 'open'::text) OR ((evidence_on IS NOT NULL) AND (length(COALESCE(evidence_ref, ''::text)) > 0)))),
    CONSTRAINT compliance_gate_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text])))
);

CREATE TABLE public.consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    key text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT consents_key_check CHECK ((key ~ '^[a-z0-9-]{1,40}$'::text))
);

CREATE TABLE public.document_types (
    id text NOT NULL,
    accepted_kinds text[] DEFAULT '{pdf}'::text[] NOT NULL,
    studios text[] DEFAULT '{document-authenticity,compliance-check}'::text[] NOT NULL,
    fields text[] DEFAULT '{}'::text[] NOT NULL,
    retention_policy text DEFAULT 'after-check'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT document_types_accepted_kinds_check CHECK ((accepted_kinds <@ ARRAY['pdf'::text])),
    CONSTRAINT document_types_id_check CHECK ((id ~ '^[a-z0-9-]{2,40}$'::text)),
    CONSTRAINT document_types_studios_check CHECK ((studios <@ ARRAY['document-authenticity'::text, 'compliance-check'::text]))
);

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    pages integer,
    content bytea NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    search tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('simple'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(text, ''::text)), 'B'::"char"))) STORED,
    sample boolean DEFAULT false NOT NULL,
    collection_id uuid,
    folder_id uuid,
    storage text DEFAULT 'database'::text NOT NULL,
    retain_until timestamp with time zone,
    storage_owner text DEFAULT 'krizaka'::text NOT NULL,
    text_source jsonb,
    screening_id uuid,
    document_type text,
    retention_policy text,
    checks_skipped jsonb DEFAULT '[]'::jsonb NOT NULL,
    extraction text DEFAULT 'done'::text NOT NULL,
    extraction_error text,
    extraction_at timestamp with time zone DEFAULT now() NOT NULL,
    keep_consent_at timestamp with time zone,
    source_sha256 text,
    document_role text DEFAULT 'lease'::text NOT NULL,
    lease_id uuid,
    object_key text,
    provider_id uuid,
    CONSTRAINT documents_document_role_check CHECK ((document_role = ANY (ARRAY['lease'::text, 'annex'::text, 'building-rules'::text]))),
    CONSTRAINT documents_extraction_check CHECK ((extraction = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text]))),
    CONSTRAINT documents_folder_in_collection CHECK (((folder_id IS NULL) OR (collection_id IS NOT NULL))),
    CONSTRAINT documents_kind_check CHECK ((kind = ANY (ARRAY['lease'::text, 'contract'::text, 'invoice'::text, 'other'::text]))),
    CONSTRAINT documents_mime_type_check CHECK ((mime_type = ANY (ARRAY['application/pdf'::text, 'text/plain'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text, 'application/vnd.oasis.opendocument.text'::text]))),
    CONSTRAINT documents_role_has_lease CHECK (((document_role = 'lease'::text) = (lease_id IS NULL))),
    CONSTRAINT documents_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 10485760))),
    CONSTRAINT documents_storage_check CHECK ((storage = ANY (ARRAY['none'::text, 'database'::text, 'bunny'::text, 's3'::text, 'cloud'::text, 'device'::text]))),
    CONSTRAINT documents_storage_owner_check CHECK ((storage_owner = ANY (ARRAY['krizaka'::text, 'workspace'::text])))
);

CREATE TABLE public.email_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    new_email text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT email_changes_new_email_check CHECK ((new_email = lower(new_email)))
);

CREATE TABLE public.email_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);

CREATE TABLE public.file_report_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screening_id uuid NOT NULL,
    landlord_id uuid NOT NULL,
    recipient text DEFAULT ''::text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    emailed_to text,
    CONSTRAINT file_report_shares_emailed_to_check CHECK (((emailed_to IS NULL) OR (length(emailed_to) <= 254))),
    CONSTRAINT file_report_shares_recipient_check CHECK ((length(recipient) <= 120))
);

CREATE TABLE public.file_report_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    share_id uuid NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text
);

CREATE TABLE public.flow_environments (
    flow_id uuid NOT NULL,
    environment text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT flow_environments_environment_check CHECK ((environment = ANY (ARRAY['dev'::text, 'prod'::text])))
);

CREATE TABLE public.flow_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow_id uuid NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    definition jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT flow_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'retired'::text]))),
    CONSTRAINT flow_versions_version_check CHECK ((version >= 1))
);

CREATE TABLE public.flows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    current_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT flows_key_check CHECK ((key ~ '^[a-z0-9-]{1,60}$'::text))
);

CREATE TABLE public.folder_tags (
    folder_id uuid NOT NULL,
    tag_id uuid NOT NULL
);

CREATE TABLE public.folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    collection_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.krizaka_module_versions (
    module text NOT NULL,
    version integer NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.libraries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.mail_intentions (
    key text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.mail_suppressions (
    email text NOT NULL,
    reason text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_suppressions_reason_check CHECK ((reason = ANY (ARRAY['bounce'::text, 'complaint'::text, 'unsubscribed'::text])))
);

CREATE TABLE public.overage_charges (
    dossier_id uuid NOT NULL,
    period text NOT NULL,
    account_id uuid NOT NULL,
    charge_ref text NOT NULL,
    amount_cents integer NOT NULL,
    charged_at timestamp with time zone NOT NULL,
    refunded_at timestamp with time zone,
    CONSTRAINT overage_charges_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT overage_charges_period_check CHECK ((period ~ '^[0-9]{4}-[0-9]{2}$'::text))
);

CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);

CREATE TABLE public.preflight_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid,
    outcome text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT preflight_events_outcome_check CHECK ((outcome = ANY (ARRAY['accepted'::text, 'rejected'::text, 'reused'::text])))
);

CREATE TABLE public.price_versions (
    id bigint NOT NULL,
    key text NOT NULL,
    price jsonb NOT NULL,
    before jsonb NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    actor_id uuid,
    actor_label text NOT NULL,
    CONSTRAINT price_versions_key_check CHECK ((key ~ '^[a-z][a-zA-Z0-9-]{0,39}[.][a-z][a-zA-Z0-9-]{0,39}$'::text))
);

CREATE SEQUENCE public.price_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.price_versions_id_seq OWNED BY public.price_versions.id;

CREATE TABLE public.report_access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analysis_id uuid NOT NULL,
    requester_id uuid NOT NULL,
    requester_email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    handled_at timestamp with time zone
);

CREATE TABLE public.report_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analysis_id uuid NOT NULL,
    granted_by uuid NOT NULL,
    grantee_email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT report_grants_grantee_email_check CHECK ((grantee_email = lower(grantee_email)))
);

CREATE TABLE public.retention_policies (
    id text NOT NULL,
    purge_on text NOT NULL,
    days integer,
    CONSTRAINT retention_policies_days_check CHECK (((days IS NULL) OR ((days >= 1) AND (days <= 3650)))),
    CONSTRAINT retention_policies_days_iff_days CHECK (((purge_on = 'days'::text) = (days IS NOT NULL))),
    CONSTRAINT retention_policies_id_check CHECK ((id ~ '^[a-z0-9-]{2,40}$'::text)),
    CONSTRAINT retention_policies_purge_on_check CHECK ((purge_on = ANY (ARRAY['after-check'::text, 'after-decision'::text, 'days'::text])))
);

CREATE TABLE public.retention_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    subject text NOT NULL,
    policy_id text NOT NULL,
    CONSTRAINT retention_rule_subject_check CHECK ((subject ~ '^[a-z0-9-]{2,40}$'::text))
);


CREATE TABLE public.screening_charge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screening_id uuid NOT NULL,
    check_type text NOT NULL,
    payer text NOT NULL,
    provider_cost_cents integer NOT NULL,
    margin_cents integer NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'CAD'::text NOT NULL,
    description text NOT NULL,
    state text NOT NULL,
    charge_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    refunded_at timestamp with time zone,
    CONSTRAINT screening_charge_check CHECK ((amount_cents = (provider_cost_cents + margin_cents))),
    CONSTRAINT screening_charge_margin_cents_check CHECK ((margin_cents >= 0)),
    CONSTRAINT screening_charge_payer_check CHECK ((payer = ANY (ARRAY['firm'::text, 'owner'::text, 'applicant'::text]))),
    CONSTRAINT screening_charge_provider_cost_cents_check CHECK ((provider_cost_cents >= 0)),
    CONSTRAINT screening_charge_state_check CHECK ((state = ANY (ARRAY['charged'::text, 'refunded'::text, 'failed'::text])))
);

CREATE TABLE public.screening_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screening_id uuid NOT NULL,
    check_type text NOT NULL,
    state text NOT NULL,
    outcome text NOT NULL,
    refusal text,
    category text DEFAULT 'NONE'::text NOT NULL,
    provider_ref text,
    run_id uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    next_poll_at timestamp with time zone,
    polls integer DEFAULT 0 NOT NULL,
    CONSTRAINT screening_checks_category_check CHECK ((category = ANY (ARRAY['TAL_NON_PAYMENT'::text, 'TAL_OTHER'::text, 'CRIMINAL'::text, 'CIVIL'::text, 'NONE'::text]))),
    CONSTRAINT screening_checks_outcome_check CHECK ((outcome = ANY (ARRAY['MATCH'::text, 'NO_MATCH'::text, 'PENDING'::text, 'PROVIDER_ERROR'::text, 'TIMEOUT'::text, 'REFUSED'::text]))),
    CONSTRAINT screening_checks_refusal_check CHECK ((refusal = ANY (ARRAY['NO_CONSENT'::text, 'NO_KEY'::text, 'BUDGET_EXHAUSTED'::text, 'NOT_CONFIGURED'::text]))),
    CONSTRAINT screening_checks_state_check CHECK ((state = ANY (ARRAY['answered'::text, 'pending'::text, 'unavailable'::text, 'soon'::text])))
);

CREATE TABLE public.screening_provider (
    id text NOT NULL,
    adapter text NOT NULL,
    label text NOT NULL,
    region text DEFAULT 'CA'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    note text,
    poll_minutes integer DEFAULT 15 NOT NULL,
    poll_max integer DEFAULT 96 NOT NULL,
    CONSTRAINT screening_provider_adapter_check CHECK ((adapter = ANY (ARRAY['demo'::text, 'engine'::text]))),
    CONSTRAINT screening_provider_id_check CHECK ((id ~ '^[a-z][a-z0-9-]{1,39}$'::text)),
    CONSTRAINT screening_provider_poll_max_check CHECK (((poll_max >= 1) AND (poll_max <= 1000))),
    CONSTRAINT screening_provider_poll_minutes_check CHECK (((poll_minutes >= 1) AND (poll_minutes <= 1440)))
);

CREATE TABLE public.screenings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    landlord_id uuid NOT NULL,
    tenant_name text NOT NULL,
    tenant_email text NOT NULL,
    scope text[] DEFAULT '{payment-history}'::text[] NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consented_at timestamp with time zone,
    shared_at timestamp with time zone,
    contested_at timestamp with time zone,
    contest_comment text,
    result jsonb,
    result_expires_at timestamp with time zone,
    purged_at timestamp with time zone,
    flow text DEFAULT 'screening'::text NOT NULL,
    requested_types text[] DEFAULT '{}'::text[] NOT NULL,
    revoked_at timestamp with time zone,
    submitted_at timestamp with time zone,
    closed_at timestamp with time zone,
    payer text DEFAULT 'owner'::text NOT NULL,
    CONSTRAINT screenings_flow_check CHECK ((flow = ANY (ARRAY['screening'::text, 'file'::text]))),
    CONSTRAINT screenings_payer_check CHECK ((payer = ANY (ARRAY['firm'::text, 'owner'::text, 'applicant'::text]))),
    CONSTRAINT screenings_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'consented'::text, 'shared'::text, 'declined'::text, 'contested'::text, 'expired'::text, 'erased'::text]))),
    CONSTRAINT screenings_tenant_email_check CHECK ((tenant_email = lower(tenant_email)))
);

CREATE TABLE public.sealed_contracts (
    id text NOT NULL,
    owner_id uuid NOT NULL,
    partner_id text NOT NULL,
    document_type text NOT NULL,
    sha256 text NOT NULL,
    zone text NOT NULL,
    key_id text NOT NULL,
    sealed_at timestamp with time zone NOT NULL,
    content bytea NOT NULL
);

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip text,
    user_agent text
);

CREATE TABLE public.settings_audit (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_label text NOT NULL,
    scope text NOT NULL,
    scope_id text DEFAULT ''::text NOT NULL,
    key text NOT NULL,
    before jsonb,
    after jsonb
);

CREATE SEQUENCE public.settings_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.settings_audit_id_seq OWNED BY public.settings_audit.id;

CREATE TABLE public.signal_answers (
    document_id uuid NOT NULL,
    signal_id text NOT NULL,
    explanation text NOT NULL,
    answered_at timestamp with time zone NOT NULL,
    CONSTRAINT signal_answers_explanation_check CHECK (((char_length(explanation) >= 1) AND (char_length(explanation) <= 600))),
    CONSTRAINT signal_answers_signal_id_check CHECK (((char_length(signal_id) >= 1) AND (char_length(signal_id) <= 64)))
);

CREATE TABLE public.storage_moves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_id uuid NOT NULL,
    to_id uuid NOT NULL,
    status text NOT NULL,
    total integer NOT NULL,
    moved integer DEFAULT 0 NOT NULL,
    failures jsonb DEFAULT '[]'::jsonb NOT NULL,
    leased_until timestamp with time zone,
    started_by text,
    started_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT storage_moves_check CHECK ((from_id <> to_id)),
    CONSTRAINT storage_moves_moved_check CHECK ((moved >= 0)),
    CONSTRAINT storage_moves_status_check CHECK ((status = ANY (ARRAY['running'::text, 'paused'::text, 'attention'::text, 'done'::text]))),
    CONSTRAINT storage_moves_total_check CHECK ((total >= 0))
);

CREATE TABLE public.storage_settings (
    owner_id uuid NOT NULL,
    mode text DEFAULT 'krizaka'::text NOT NULL,
    keep_default boolean DEFAULT false NOT NULL,
    s3_endpoint text,
    s3_region text,
    s3_bucket text,
    s3_access_key_id text,
    s3_secret_sealed text,
    tested_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_id uuid,
    cloud_connector text,
    CONSTRAINT storage_settings_mode_check CHECK ((mode = ANY (ARRAY['none'::text, 'krizaka'::text, 's3'::text, 'cloud'::text])))
);

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    CONSTRAINT tags_color_check CHECK ((color = ANY (ARRAY['blue'::text, 'green'::text, 'amber'::text, 'red'::text, 'violet'::text, 'gray'::text])))
);

CREATE TABLE public.tenant_check_setting (
    owner_id uuid NOT NULL,
    check_type text NOT NULL,
    allowed boolean NOT NULL
);

CREATE TABLE public.webhook_deliveries (
    id uuid NOT NULL,
    endpoint_id uuid NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    last_status integer,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text])))
);

CREATE TABLE public.webhook_endpoints (
    id uuid NOT NULL,
    owner_id uuid NOT NULL,
    url text NOT NULL,
    secret_sealed text NOT NULL,
    events text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    disabled_why text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT webhook_endpoints_events_check CHECK ((cardinality(events) > 0)),
    CONSTRAINT webhook_endpoints_url_check CHECK ((char_length(url) <= 500))
);

CREATE TABLE public.webhook_received (
    source text NOT NULL,
    event_id text NOT NULL,
    received_at timestamp with time zone NOT NULL
);

CREATE TABLE storage.default_provider (
    scope text NOT NULL,
    data_kind text NOT NULL,
    provider_id uuid NOT NULL,
    CONSTRAINT default_provider_data_kind_check CHECK ((data_kind ~ '^[a-z][a-z0-9_-]*$'::text))
);

CREATE TABLE storage.provider (
    id uuid NOT NULL,
    scope text NOT NULL,
    kind text NOT NULL,
    preset text,
    label text NOT NULL,
    coordinates jsonb DEFAULT '{}'::jsonb NOT NULL,
    sealed_credentials text NOT NULL,
    key_id text NOT NULL,
    status text NOT NULL,
    source text DEFAULT 'admin'::text NOT NULL,
    last_test jsonb,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT provider_kind_check CHECK ((kind ~ '^[a-z][a-z0-9-]*$'::text)),
    CONSTRAINT provider_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 80))),
    CONSTRAINT provider_scope_check CHECK (((scope = 'org'::text) OR (scope ~ '^user:[A-Za-z0-9_-]{1,64}$'::text))),
    CONSTRAINT provider_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'env'::text]))),
    CONSTRAINT provider_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'verified'::text, 'active'::text, 'retiring'::text, 'disabled'::text])))
);

ALTER TABLE ONLY audit.entry ALTER COLUMN id SET DEFAULT nextval('audit.entry_id_seq'::regclass);

ALTER TABLE ONLY privacy.consent ALTER COLUMN seq SET DEFAULT nextval('privacy.consent_seq_seq'::regclass);

ALTER TABLE ONLY public.audit_log ALTER COLUMN at SET DEFAULT now();

ALTER TABLE ONLY public.price_versions ALTER COLUMN id SET DEFAULT nextval('public.price_versions_id_seq'::regclass);

ALTER TABLE ONLY public.settings_audit ALTER COLUMN id SET DEFAULT nextval('public.settings_audit_id_seq'::regclass);

ALTER TABLE ONLY audit.entry
    ADD CONSTRAINT entry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY coupons.coupon
    ADD CONSTRAINT coupon_code_key_key UNIQUE (code_key);

ALTER TABLE ONLY coupons.coupon
    ADD CONSTRAINT coupon_pkey PRIMARY KEY (id);

ALTER TABLE ONLY coupons.partner
    ADD CONSTRAINT partner_pkey PRIMARY KEY (id);

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_checkout_ref_key UNIQUE (checkout_ref);

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_payment_ref_key UNIQUE (payment_ref);

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_pkey PRIMARY KEY (id);

ALTER TABLE ONLY credits.entry
    ADD CONSTRAINT entry_idempotency_key_key UNIQUE (idempotency_key);

ALTER TABLE ONLY credits.entry
    ADD CONSTRAINT entry_pkey PRIMARY KEY (id);

ALTER TABLE ONLY credits."grant"
    ADD CONSTRAINT grant_pkey PRIMARY KEY (id);

ALTER TABLE ONLY credits.hold
    ADD CONSTRAINT hold_operation_key UNIQUE (operation);

ALTER TABLE ONLY credits.hold
    ADD CONSTRAINT hold_pkey PRIMARY KEY (id);

ALTER TABLE ONLY organize.applicant_file_status
    ADD CONSTRAINT applicant_file_status_pkey PRIMARY KEY (entity_id);

ALTER TABLE ONLY organize.applicant_file_tag
    ADD CONSTRAINT applicant_file_tag_pkey PRIMARY KEY (entity_id, tag_id);

ALTER TABLE ONLY organize.document_status
    ADD CONSTRAINT document_status_pkey PRIMARY KEY (entity_id);

ALTER TABLE ONLY organize.document_tag
    ADD CONSTRAINT document_tag_pkey PRIMARY KEY (entity_id, tag_id);

ALTER TABLE ONLY organize.kind_config
    ADD CONSTRAINT kind_config_pkey PRIMARY KEY (kind);

ALTER TABLE ONLY organize.tag
    ADD CONSTRAINT tag_id_kind_key UNIQUE (id, kind);

ALTER TABLE ONLY organize.tag
    ADD CONSTRAINT tag_pkey PRIMARY KEY (id);

ALTER TABLE ONLY organize.view
    ADD CONSTRAINT view_pkey PRIMARY KEY (id);

ALTER TABLE ONLY payments.discount
    ADD CONSTRAINT discount_pkey PRIMARY KEY (coupon_id, terms_version, provider);

ALTER TABLE ONLY payments.event
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY privacy.consent
    ADD CONSTRAINT consent_pkey PRIMARY KEY (id);

ALTER TABLE ONLY privacy.consent
    ADD CONSTRAINT consent_seq_key UNIQUE (seq);

ALTER TABLE ONLY privacy.incident
    ADD CONSTRAINT incident_pkey PRIMARY KEY (id);

ALTER TABLE ONLY privacy.request
    ADD CONSTRAINT request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_email_key UNIQUE (email);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_payment_customer_id_key UNIQUE (payment_customer_id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analyses
    ADD CONSTRAINT analyses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_public_id_key UNIQUE (public_id);

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (scope, scope_id, key);

ALTER TABLE ONLY public.application_consents
    ADD CONSTRAINT application_consents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_batch_id_line_key UNIQUE (batch_id, line);

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.check_type
    ADD CONSTRAINT check_type_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.collections_tags
    ADD CONSTRAINT collection_tags_pkey PRIMARY KEY (collection_id, tag_id);

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_library_id_name_key UNIQUE (library_id, name);

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_one_default EXCLUDE USING btree (owner_id WITH =) WHERE (is_default) DEFERRABLE;

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.compliance_gate
    ADD CONSTRAINT compliance_gate_pkey PRIMARY KEY (blocker);

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.document_types
    ADD CONSTRAINT document_types_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_owner_id_sha256_key UNIQUE (owner_id, sha256);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_changes
    ADD CONSTRAINT email_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_changes
    ADD CONSTRAINT email_changes_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.file_report_shares
    ADD CONSTRAINT file_report_shares_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.file_report_shares
    ADD CONSTRAINT file_report_shares_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.file_report_views
    ADD CONSTRAINT file_report_views_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.flow_environments
    ADD CONSTRAINT flow_environments_pkey PRIMARY KEY (flow_id, environment);

ALTER TABLE ONLY public.flow_versions
    ADD CONSTRAINT flow_versions_flow_id_version_key UNIQUE (flow_id, version);

ALTER TABLE ONLY public.flow_versions
    ADD CONSTRAINT flow_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_key_key UNIQUE (key);

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.folder_tags
    ADD CONSTRAINT folder_tags_pkey PRIMARY KEY (folder_id, tag_id);

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_collection_id_name_key UNIQUE (collection_id, name);

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.krizaka_module_versions
    ADD CONSTRAINT krizaka_module_versions_pkey PRIMARY KEY (module, version);

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_id_owner UNIQUE (id, owner_id);

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_owner_id_name_key UNIQUE (owner_id, name);

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mail_intentions
    ADD CONSTRAINT mail_intentions_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.mail_suppressions
    ADD CONSTRAINT mail_suppressions_pkey PRIMARY KEY (email);

ALTER TABLE ONLY public.overage_charges
    ADD CONSTRAINT overage_charges_pkey PRIMARY KEY (dossier_id, period);

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.preflight_events
    ADD CONSTRAINT preflight_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.price_versions
    ADD CONSTRAINT price_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.report_access_requests
    ADD CONSTRAINT report_access_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.report_grants
    ADD CONSTRAINT report_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.retention_rule
    ADD CONSTRAINT retention_rule_pkey PRIMARY KEY (id);


ALTER TABLE ONLY public.screening_charge
    ADD CONSTRAINT screening_charge_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.screening_charge
    ADD CONSTRAINT screening_charge_screening_id_check_type_key UNIQUE (screening_id, check_type);

ALTER TABLE ONLY public.screening_checks
    ADD CONSTRAINT screening_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.screening_checks
    ADD CONSTRAINT screening_checks_screening_id_check_type_key UNIQUE (screening_id, check_type);

ALTER TABLE ONLY public.screening_provider
    ADD CONSTRAINT screening_provider_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.screenings
    ADD CONSTRAINT screenings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.screenings
    ADD CONSTRAINT screenings_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.sealed_contracts
    ADD CONSTRAINT sealed_contracts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sealed_contracts
    ADD CONSTRAINT sealed_contracts_sha256_key UNIQUE (sha256);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.settings_audit
    ADD CONSTRAINT settings_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.signal_answers
    ADD CONSTRAINT signal_answers_pkey PRIMARY KEY (document_id, signal_id);

ALTER TABLE ONLY public.storage_moves
    ADD CONSTRAINT storage_moves_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.storage_settings
    ADD CONSTRAINT storage_settings_pkey PRIMARY KEY (owner_id);

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tenant_check_setting
    ADD CONSTRAINT tenant_check_setting_pkey PRIMARY KEY (owner_id, check_type);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_id_event_id_key UNIQUE (endpoint_id, event_id);

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.webhook_received
    ADD CONSTRAINT webhook_received_pkey PRIMARY KEY (source, event_id);

ALTER TABLE ONLY storage.default_provider
    ADD CONSTRAINT default_provider_pkey PRIMARY KEY (scope, data_kind);

ALTER TABLE ONLY storage.provider
    ADD CONSTRAINT provider_pkey PRIMARY KEY (id);

CREATE INDEX entry_action ON audit.entry USING btree (action, at DESC);

CREATE INDEX entry_actor ON audit.entry USING btree (actor_id) WHERE (actor_id IS NOT NULL);

CREATE INDEX entry_at ON audit.entry USING btree (at DESC);

CREATE INDEX entry_target ON audit.entry USING btree (target_type, target_id, at DESC);

CREATE INDEX coupon_partner ON coupons.coupon USING btree (partner_id) WHERE (partner_id IS NOT NULL);

CREATE INDEX redemption_partner ON coupons.redemption USING btree (partner_id, confirmed_at) WHERE (partner_id IS NOT NULL);

CREATE INDEX redemption_reserved ON coupons.redemption USING btree (reserved_until) WHERE (status = 'reserved'::text);

CREATE INDEX redemption_uses ON coupons.redemption USING btree (coupon_id, account_id) WHERE ((status <> 'released'::text) AND (NOT use_restored));

CREATE INDEX entry_account ON credits.entry USING btree (account_id, seq DESC);

CREATE INDEX entry_grant ON credits.entry USING btree (grant_id);

CREATE INDEX entry_operation ON credits.entry USING btree (operation);

CREATE INDEX grant_account ON credits."grant" USING btree (account_id, created_at);

CREATE INDEX grant_lapse ON credits."grant" USING btree (expires_at) WHERE (bucket = 'granted'::text);

CREATE INDEX hold_active ON credits.hold USING btree (account_id) WHERE (status = 'active'::text);

CREATE INDEX applicant_file_status_state ON organize.applicant_file_status USING btree (state);

CREATE INDEX applicant_file_tag_tag ON organize.applicant_file_tag USING btree (tag_id);

CREATE INDEX document_status_state ON organize.document_status USING btree (state);

CREATE INDEX document_tag_tag ON organize.document_tag USING btree (tag_id);

CREATE UNIQUE INDEX tag_scope_kind_name ON organize.tag USING btree (scope_id, kind, lower(name));

CREATE UNIQUE INDEX view_author_name ON organize.view USING btree (scope_id, kind, author_id, lower(name));

CREATE INDEX view_shared ON organize.view USING btree (scope_id, kind) WHERE shared;

CREATE INDEX consent_subject ON privacy.consent USING btree (subject_kind, subject_id, purpose, seq DESC);

CREATE INDEX incident_scope ON privacy.incident USING btree (scope, aware_at, id);

CREATE INDEX request_subject ON privacy.request USING btree (subject_kind, subject_id, requested_at DESC);

CREATE INDEX analyses_document ON public.analyses USING btree (document_id, created_at DESC);

CREATE INDEX analyses_search ON public.analyses USING gin (to_tsvector('simple'::regconfig, search_text));

CREATE INDEX analyses_showcase ON public.analyses USING btree (finished_at DESC) WHERE showcase;

CREATE INDEX api_keys_owner ON public.api_keys USING btree (owner_id, created_at);

CREATE UNIQUE INDEX application_consents_active ON public.application_consents USING btree (screening_id, purpose) WHERE (withdrawn_at IS NULL);

CREATE INDEX batch_items_state ON public.batch_items USING btree (batch_id, state);

CREATE INDEX batches_open ON public.batches USING btree (created_at) WHERE (finished_at IS NULL);

CREATE INDEX batches_owner ON public.batches USING btree (owner_id, created_at DESC);

CREATE UNIQUE INDEX consents_live ON public.consents USING btree (account_id, key) WHERE (revoked_at IS NULL);

CREATE INDEX documents_collection ON public.documents USING btree (collection_id, folder_id);

CREATE INDEX documents_lease ON public.documents USING btree (lease_id) WHERE (lease_id IS NOT NULL);

CREATE INDEX documents_object_key ON public.documents USING btree (object_key) WHERE (object_key IS NOT NULL);

CREATE INDEX documents_owner ON public.documents USING btree (owner_id, created_at DESC);

CREATE INDEX documents_provider_id ON public.documents USING btree (provider_id) WHERE (provider_id IS NOT NULL);

CREATE INDEX documents_screening ON public.documents USING btree (screening_id) WHERE (screening_id IS NOT NULL);

CREATE INDEX documents_search ON public.documents USING gin (search);

CREATE INDEX documents_source_sha256 ON public.documents USING btree (owner_id, source_sha256) WHERE (source_sha256 IS NOT NULL);

CREATE INDEX email_verifications_account ON public.email_verifications USING btree (account_id);

CREATE INDEX file_report_shares_file ON public.file_report_shares USING btree (screening_id, created_at DESC);

CREATE INDEX file_report_views_share ON public.file_report_views USING btree (share_id, viewed_at DESC);

CREATE INDEX overage_charges_account ON public.overage_charges USING btree (account_id, period);

CREATE INDEX preflight_events_account ON public.preflight_events USING btree (account_id, created_at DESC);

CREATE INDEX price_versions_key ON public.price_versions USING btree (key, id);

CREATE UNIQUE INDEX report_access_requests_open ON public.report_access_requests USING btree (analysis_id, requester_id) WHERE (handled_at IS NULL);

CREATE INDEX report_grants_email ON public.report_grants USING btree (grantee_email);

CREATE UNIQUE INDEX report_grants_live ON public.report_grants USING btree (analysis_id, grantee_email) WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX retention_rule_global ON public.retention_rule USING btree (subject) WHERE (owner_id IS NULL);

CREATE UNIQUE INDEX retention_rule_owner ON public.retention_rule USING btree (owner_id, subject) WHERE (owner_id IS NOT NULL);

CREATE INDEX screening_checks_due ON public.screening_checks USING btree (next_poll_at) WHERE (state = 'pending'::text);

CREATE INDEX screenings_landlord ON public.screenings USING btree (landlord_id, created_at DESC);

CREATE INDEX sealed_contracts_owner ON public.sealed_contracts USING btree (owner_id, sealed_at DESC);

CREATE INDEX sessions_account ON public.sessions USING btree (account_id);

CREATE INDEX settings_audit_key ON public.settings_audit USING btree (key, id DESC);

CREATE UNIQUE INDEX storage_moves_one_open ON public.storage_moves USING btree ((true)) WHERE (status <> 'done'::text);

CREATE UNIQUE INDEX tags_owner_name ON public.tags USING btree (owner_id, lower(name));

CREATE INDEX webhook_deliveries_due ON public.webhook_deliveries USING btree (next_attempt_at) WHERE (status = 'pending'::text);

CREATE INDEX webhook_endpoints_owner ON public.webhook_endpoints USING btree (owner_id);

CREATE INDEX provider_scope ON storage.provider USING btree (scope, status);

CREATE TRIGGER entry_append_only BEFORE DELETE OR UPDATE ON credits.entry FOR EACH ROW EXECUTE FUNCTION credits.entry_is_append_only();

CREATE TRIGGER consent_written_once BEFORE UPDATE ON privacy.consent FOR EACH ROW EXECUTE FUNCTION privacy.consent_written_once();

CREATE TRIGGER incident_guard BEFORE DELETE OR UPDATE ON privacy.incident FOR EACH ROW EXECUTE FUNCTION privacy.incident_guard();

CREATE TRIGGER accounts_default_collection AFTER INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.accounts_default_collection();

CREATE CONSTRAINT TRIGGER collections_exactly_one_default AFTER INSERT OR DELETE OR UPDATE ON public.collections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.collections_exactly_one_default();

CREATE TRIGGER collections_fill_owner BEFORE INSERT ON public.collections FOR EACH ROW WHEN ((new.owner_id IS NULL)) EXECUTE FUNCTION public.collections_fill_owner();

CREATE TRIGGER collections_guard_default BEFORE DELETE ON public.collections FOR EACH ROW EXECUTE FUNCTION public.collections_guard_default();

CREATE TRIGGER documents_default_collection BEFORE INSERT OR UPDATE OF collection_id ON public.documents FOR EACH ROW WHEN ((new.collection_id IS NULL)) EXECUTE FUNCTION public.documents_default_collection();

ALTER TABLE ONLY audit.entry
    ADD CONSTRAINT entry_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY coupons.coupon
    ADD CONSTRAINT coupon_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY coupons.coupon
    ADD CONSTRAINT coupon_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES coupons.partner(id) ON DELETE RESTRICT;

ALTER TABLE ONLY coupons.partner
    ADD CONSTRAINT partner_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES coupons.coupon(id) ON DELETE RESTRICT;

ALTER TABLE ONLY coupons.redemption
    ADD CONSTRAINT redemption_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES coupons.partner(id) ON DELETE SET NULL;

ALTER TABLE ONLY credits.entry
    ADD CONSTRAINT entry_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES credits."grant"(id);

ALTER TABLE ONLY organize.applicant_file_status
    ADD CONSTRAINT applicant_file_status_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY organize.applicant_file_status
    ADD CONSTRAINT applicant_file_status_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.screenings(id) ON DELETE CASCADE;

ALTER TABLE ONLY organize.applicant_file_tag
    ADD CONSTRAINT applicant_file_tag_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.screenings(id) ON DELETE CASCADE;

ALTER TABLE ONLY organize.applicant_file_tag
    ADD CONSTRAINT applicant_file_tag_tag_id_kind_fkey FOREIGN KEY (tag_id, kind) REFERENCES organize.tag(id, kind) ON DELETE CASCADE;

ALTER TABLE ONLY organize.document_status
    ADD CONSTRAINT document_status_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY organize.document_status
    ADD CONSTRAINT document_status_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY organize.document_tag
    ADD CONSTRAINT document_tag_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY organize.document_tag
    ADD CONSTRAINT document_tag_tag_id_kind_fkey FOREIGN KEY (tag_id, kind) REFERENCES organize.tag(id, kind) ON DELETE CASCADE;

ALTER TABLE ONLY organize.kind_config
    ADD CONSTRAINT kind_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY organize.tag
    ADD CONSTRAINT tag_scope_id_fkey FOREIGN KEY (scope_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY organize.view
    ADD CONSTRAINT view_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY organize.view
    ADD CONSTRAINT view_scope_id_fkey FOREIGN KEY (scope_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analyses
    ADD CONSTRAINT analyses_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analyses
    ADD CONSTRAINT analyses_flow_version_id_fkey FOREIGN KEY (flow_version_id) REFERENCES public.flow_versions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_rotated_from_id_fkey FOREIGN KEY (rotated_from_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.application_consents
    ADD CONSTRAINT application_consents_screening_id_fkey FOREIGN KEY (screening_id) REFERENCES public.screenings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.batch_items
    ADD CONSTRAINT batch_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.check_type
    ADD CONSTRAINT check_type_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.screening_provider(id);

ALTER TABLE ONLY public.collections_tags
    ADD CONSTRAINT collection_tags_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.collections_tags
    ADD CONSTRAINT collection_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.libraries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_library_owner FOREIGN KEY (library_id, owner_id) REFERENCES public.libraries(id, owner_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_types
    ADD CONSTRAINT document_types_retention_policy_fkey FOREIGN KEY (retention_policy) REFERENCES public.retention_policies(id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_document_type_fkey FOREIGN KEY (document_type) REFERENCES public.document_types(id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_lease_id_fkey FOREIGN KEY (lease_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_retention_policy_fkey FOREIGN KEY (retention_policy) REFERENCES public.retention_policies(id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_screening_id_fkey FOREIGN KEY (screening_id) REFERENCES public.screenings(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.email_changes
    ADD CONSTRAINT email_changes_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.file_report_shares
    ADD CONSTRAINT file_report_shares_landlord_id_fkey FOREIGN KEY (landlord_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.file_report_shares
    ADD CONSTRAINT file_report_shares_screening_id_fkey FOREIGN KEY (screening_id) REFERENCES public.screenings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.file_report_views
    ADD CONSTRAINT file_report_views_share_id_fkey FOREIGN KEY (share_id) REFERENCES public.file_report_shares(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flow_environments
    ADD CONSTRAINT flow_environments_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flow_versions
    ADD CONSTRAINT flow_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.flow_versions
    ADD CONSTRAINT flow_versions_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.flows
    ADD CONSTRAINT flows_current_version FOREIGN KEY (current_version_id) REFERENCES public.flow_versions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.folder_tags
    ADD CONSTRAINT folder_tags_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.folder_tags
    ADD CONSTRAINT folder_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.overage_charges
    ADD CONSTRAINT overage_charges_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.preflight_events
    ADD CONSTRAINT preflight_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.report_access_requests
    ADD CONSTRAINT report_access_requests_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.report_access_requests
    ADD CONSTRAINT report_access_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.report_grants
    ADD CONSTRAINT report_grants_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.report_grants
    ADD CONSTRAINT report_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.retention_rule
    ADD CONSTRAINT retention_rule_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.retention_rule
    ADD CONSTRAINT retention_rule_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.retention_policies(id);

ALTER TABLE ONLY public.screening_charge
    ADD CONSTRAINT screening_charge_check_type_fkey FOREIGN KEY (check_type) REFERENCES public.check_type(key);

ALTER TABLE ONLY public.screening_charge
    ADD CONSTRAINT screening_charge_screening_id_fkey FOREIGN KEY (screening_id) REFERENCES public.screenings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.screening_checks
    ADD CONSTRAINT screening_checks_check_type_fkey FOREIGN KEY (check_type) REFERENCES public.check_type(key);

ALTER TABLE ONLY public.screening_checks
    ADD CONSTRAINT screening_checks_screening_id_fkey FOREIGN KEY (screening_id) REFERENCES public.screenings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.screenings
    ADD CONSTRAINT screenings_landlord_id_fkey FOREIGN KEY (landlord_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sealed_contracts
    ADD CONSTRAINT sealed_contracts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.signal_answers
    ADD CONSTRAINT signal_answers_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.storage_settings
    ADD CONSTRAINT storage_settings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tenant_check_setting
    ADD CONSTRAINT tenant_check_setting_check_type_fkey FOREIGN KEY (check_type) REFERENCES public.check_type(key);

ALTER TABLE ONLY public.tenant_check_setting
    ADD CONSTRAINT tenant_check_setting_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY storage.default_provider
    ADD CONSTRAINT default_provider_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES storage.provider(id);

INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('settings', 1, '051524285802ef38f829227d81f34935afd8999c2f83be821d25b1f6078ac7a1');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('settings_prices', 1, 'a2cad37a2efe0309a4114b7bfe67fa5fc9766d7a5d3aba4e1edbc4157125c11f');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('auth', 1, 'a48bf5bf2db6f001d588c012447f75ea8fd3d57f049debd1ba1de801dc037628');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('api_keys', 1, '65a8c2cee01432a016cb553fb8f9765e39a9fe51f1ad30bfab7693120a65ac20');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('webhooks', 1, 'f7850a9284262b6daffebc41540647ccae5cc6ea7842fdd765fbf3b483d751e9');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('organize_workspace', 1, '40aad1cd1db0f5cf96e43a4015934b9c633b8b993d58f3ff7273319fc0bf6a6b');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('audit', 1, '0a4bb651cf3e6b34f99bc29b22944e7ef7da1a1ce28df02807b45ca51cbf722d');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('auth_sessions', 1, '25ebd4e197a9af3c91386dd4142abcb58c58aac7142bfe4fb18efa2a282f8421');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('credits', 1, 'b5fe874f1d0744f78a24771c90e9a208885629585a4b783ed767c7f8ce9d3629');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('privacy', 1, '1c0fbc2cedba58b2034b666555621389230bfef102dd6b5f7fcf54302a6d3464');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('payments', 1, 'f4177a35d05450c0f9696cedb9b2dc681ec3ab9cd3739013f8b7675b7e6fbb33');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('coupons', 1, 'b89747432ea7c53478ed6cefc7d44e7463093d79324c70660909d8a66ff779f4');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('privacy', 2, '17f9b2e4492024745aa5ac4c82141b8781439a26974c6dafa922da5ae1eaeee7');
INSERT INTO public.krizaka_module_versions (module, version, checksum) VALUES ('storage', 1, 'ea5bff037ff78f0cffd7475b7fc034dc2f1612391e9ab4effd5cc3c74d56b126');
`,
  },
];
