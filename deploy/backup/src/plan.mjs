// The pure rules of the backup: names, retention, freshness, row-count comparison and the guards that make a bad run fail loudly.
// Nothing here touches the clock, the disk, the database or the network: the run (run.mjs) passes everything in.
import { differenceInHours, format } from "date-fns";

export const DATA_KIND_BACKUPS = "backups";
export const AGE_HEADER = "age-encryption.org/v1";
export const DUMP_SUFFIX = ".dump.age";
export const MANIFEST_SUFFIX = ".manifest.json";
export const RETENTION_DAYS = 30;
// @fixed: a failed week of backups must never leave the store empty: the newest copies survive any retention window
export const MIN_KEEP = 7;
// @fixed: the freshness alarm fires when the newest copy is older than a night plus slack
export const MAX_AGE_HOURS = 36;
// @fixed: the store port takes the whole object in memory (no multipart yet): a larger dump asks for streaming in @krizaka/storage first
export const MAX_DUMP_BYTES = 200 * 1024 * 1024;

/** A refusal with a stable code; the entry point prints `BACKUP_FAILED <code>` and exits 1. */
export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

const pad = (s) => String(s).padStart(2, "0");
/** `20261029T031500Z` — the UTC stamp the key carries (sorted as a string = sorted in time). */
export const stampOf = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
export const dateOfStamp = (stamp) => {
  const m = STAMP.exec(stamp);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
};

export const prefixOf = (environment) => `backups/verikora/${environment}/`;
export function dumpKey(environment, date) {
  if (!/^[a-z0-9-]{2,20}$/.test(environment))
    throw new BackupError("BAD_ENVIRONMENT", `the environment name is not usable in a key: ${environment}`);
  return `${prefixOf(environment)}verikora-${environment}-${stampOf(date)}${DUMP_SUFFIX}`;
}
export const manifestKeyOf = (dump) => `${dump.slice(0, -DUMP_SUFFIX.length)}${MANIFEST_SUFFIX}`;

/** The backups among the listed objects, newest first; anything that is not ours (foreign names) is ignored and never deleted. */
export function backupsIn(listed, environment) {
  const prefix = prefixOf(environment);
  const own = new RegExp(`^${prefix}verikora-${environment}-(\\d{8}T\\d{6}Z)\\.dump\\.age$`);
  return listed
    .map((o) => ({ key: o.key, size: o.size, at: dateOfStamp(own.exec(o.key)?.[1] ?? "") }))
    .filter((b) => b.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** What retention deletes: copies older than `days`, never the newest `minKeep`. Returns the dump keys (their manifests go with them). */
export function expired(backups, now, days = RETENTION_DAYS, minKeep = MIN_KEEP) {
  return backups
    .slice(minKeep)
    .filter((b) => differenceInHours(now, b.at) > days * 24)
    .map((b) => b.key);
}

/** The alarm: the newest copy is missing or too old. Returns null when fresh, else the refusal. */
export function staleness(backups, now, maxHours = MAX_AGE_HOURS) {
  const newest = backups[0];
  if (!newest) return new BackupError("NO_BACKUP", "no backup exists at the destination");
  const age = differenceInHours(now, newest.at);
  return age > maxHours
    ? new BackupError("STALE", `the newest backup is ${age} h old (limit ${maxHours} h): ${newest.key}`)
    : null;
}

/** Row counts (table → n) that must be identical after the restore. Returns the differences; empty means the drill passed. */
export function countDifferences(source, restored) {
  const names = [...new Set([...Object.keys(source), ...Object.keys(restored)])].sort((a, b) => a.localeCompare(b));
  return names.flatMap((t) => {
    const a = source[t];
    const b = restored[t];
    return a === b ? [] : [{ table: t, source: a ?? null, restored: b ?? null }];
  });
}

/** A dump with no table, or only empty tables, is a failed dump that looks like a success. */
export function assertWorthKeeping(counts) {
  const tables = Object.keys(counts);
  if (tables.length === 0)
    throw new BackupError("EMPTY_DATABASE", "the database lists no table: refusing to call this a backup");
  if (!Object.values(counts).some((n) => n > 0))
    throw new BackupError("ALL_EMPTY", "every table is empty: refusing to call this a backup");
}

/** pg_dump must not be older than the server (it would refuse or write a dump the server's restore cannot read). */
export function assertDumpClient(serverMajor, clientMajor) {
  if (!Number.isInteger(serverMajor) || !Number.isInteger(clientMajor))
    throw new BackupError("BAD_VERSION", "cannot read the PostgreSQL versions");
  if (clientMajor < serverMajor)
    throw new BackupError(
      "CLIENT_TOO_OLD",
      `pg_dump ${clientMajor} is older than the server ${serverMajor}: rebuild the job image with a newer client`,
    );
}
export const majorOf = (text) => Number(/(\d+)(?:\.\d+)*/.exec(text)?.[1]);

/** The destination must be a Canadian region and a provider the admin has verified (never a guess in Canada's favour). */
export function assertDestination(provider, residency) {
  if (!provider)
    throw new BackupError(
      "NO_DESTINATION",
      "no backup destination: an admin sets a default provider for « backups » (Administration → Storage)",
    );
  if (provider.status !== "active" && provider.status !== "verified")
    throw new BackupError("DESTINATION_NOT_VERIFIED", `the backup provider is ${provider.status}, not verified`);
  if (residency !== "canada")
    throw new BackupError("NOT_CANADA", `the backup provider is not in Canada (${residency}): Loi 25`);
}

/** A recipient is an age public key; a private key (AGE-SECRET-KEY-…) in the job's environment is refused outright. */
export function assertRecipient(value) {
  if (!value) throw new BackupError("NO_RECIPIENT", "BACKUP_AGE_RECIPIENT (an age public key) is not set");
  if (/^AGE-SECRET-KEY-/i.test(value))
    throw new BackupError(
      "PRIVATE_KEY_IN_ENV",
      "a private age key must never be on the server: set the public key (age1…)",
    );
  if (!/^age1[0-9a-z]{50,}$/.test(value))
    throw new BackupError("BAD_RECIPIENT", "BACKUP_AGE_RECIPIENT is not an age public key (age1…)");
  return value;
}

export const scratchName = (date) => `verikora_drill_${format(date, "yyyyMMddHHmmss")}`;
