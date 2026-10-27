import { auditContributor, createPrivacy, type Privacy, type PrivacyContributor, type Subject } from "@krizaka/privacy";
import { retentionFromSettings } from "@krizaka/privacy/settings";

import { systemClock } from "../app/system-clock";
import { exportData, type StoresOf } from "./account/export";
import { trail } from "./audit";
import { ledger } from "./audit-credits";
import { query, transaction } from "./db";
import { appSettings } from "./settings/instance";

/**
 * Privacy (Loi 25) on `@krizaka/privacy` (yomizaka#264): the consents by purpose, the export of what every module holds about a person, and
 * their erasure in one transaction. A subject here is an account.
 */
export const accountSubject = (accountId: string): Subject => ({ kind: "account", id: accountId });

/** The purposes a person has said something about (a consent or a withdrawal): what an erasure must withdraw. */
export async function purposesOf(accountId: string): Promise<string[]> {
  const rows = await query<{ purpose: string }>("SELECT DISTINCT purpose FROM privacy.consent WHERE subject_kind = 'account' AND subject_id = $1", [accountId]);
  return rows.map((r) => r.purpose);
}

/** What the module holds about the person, as a part of the export (and, for the identity, what an erasure removes last). */
const contributors = (deps: { stores: StoresOf; now: Date }, privacy: () => Privacy): PrivacyContributor[] => [
  {
    // the trail's export is the package's; its erasure is stricter than `redactActor`: the person's entries lose the label, the address AND the detail (which may name them)
    ...auditContributor(trail),
    async eraseFor(tx, subject) {
      await tx("UPDATE audit.entry SET actor_label = 'deleted account', ip = NULL, detail = '{}'::jsonb WHERE actor_id = $1::uuid OR target_id = $1::text", [subject.id]);
    },
  },
  {
    name: "yomizaka",
    // the profile, the billing state, the libraries, the tags and the documents with their kept files and reports
    async exportFor(q, subject) {
      return exportData(q, subject.id, deps.stores, deps.now);
    },
    async eraseFor() {
      // the files and rows go with the identity below (every table points at the account and cascades); the stores' files were deleted before
    },
  },
  {
    name: "screenings",
    // the screenings the person asked for as a landlord: who, which scope, where it stands. The result itself is the tenant's, never exported here.
    async exportFor(q, subject) {
      return q("SELECT id, tenant_name, tenant_email, scope, provider, status, created_at, expires_at, consented_at, shared_at, contested_at FROM screenings WHERE landlord_id = $1 ORDER BY created_at", [subject.id]);
    },
    async eraseFor() {
      // cascaded with the identity
    },
  },
  {
    name: "credits",
    // the audit credits ledger: every line. It is an accounting record: erasing the person leaves the lines under an id that points at no one.
    async exportFor(q, subject) {
      return ledger.history(q, subject.id, { limit: 500 });
    },
    async eraseFor() {
      // kept, by design (migration 0050 dropped the owner key)
    },
  },
  {
    name: "consents",
    async exportFor(q, subject) {
      return privacy().consentHistory(q, subject);
    },
    async eraseFor() {
      // `eraseSubject` withdraws the live ones itself; the history stays as the proof of what was agreed to
    },
  },
  {
    // last: the account and everything that cascades from it (sessions, documents, libraries, screenings, flows consents of the old table…)
    name: "identity",
    async exportFor() {
      return undefined;
    },
    async eraseFor(tx, subject) {
      await tx("DELETE FROM accounts WHERE id = $1", [subject.id]);
    },
  },
];

/**
 * The privacy object for one use. `purposes` are the ones the call may write or withdraw (see `purposeOfKey`, `purposesOf`); `stores`
 * and `now` serve the export of the documents.
 */
export function privacyFor(deps: { stores: StoresOf; purposes: readonly string[]; now?: Date }): Privacy {
  const full = { stores: deps.stores, now: deps.now ?? systemClock.now() };
  const privacy: Privacy = createPrivacy({
    clock: systemClock,
    purposes: deps.purposes,
    contributors: contributors(full, () => privacy),
    transaction,
    audit: trail,
    // the days a purpose is kept: `privacy.retention.<purpose>Days` of the admin's settings (no purpose declares one yet)
    retentionDays: retentionFromSettings((key) => appSettings().get(key as never) as Promise<number | undefined>),
  });
  return privacy;
}

/** The consents alone (record, read, history): no module to export or erase. `purposes` are the ones the call may write. */
export const consentsFor = (purposes: readonly string[]): Privacy => createPrivacy({ clock: systemClock, purposes, contributors: [], transaction });
