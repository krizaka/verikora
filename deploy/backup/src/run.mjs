// The orchestration of one backup and its drill. Every effect is a port (db, tools, store, clock, log), so the order of the steps and
// the way each one fails are tested without PostgreSQL, age or a bucket (run.test.mjs); adapters.mjs holds the real ports.
//
// Order: snapshot + counts (one REPEATABLE READ snapshot) → pg_dump of that snapshot → RESTORE of the plain dump into a scratch
// database and compare the counts (the drill) → age-encrypt → upload → read back and compare SHA-256 → manifest → retention.
// The drill uses the dump BEFORE encryption on purpose: the private key never sits on the server (it is offline), so the server can
// prove the dump restores and that the uploaded bytes are the encrypted ones; opening the encrypted copy is the quarterly offline drill.
import {
  AGE_HEADER,
  assertDestination,
  assertDumpClient,
  assertRecipient,
  assertWorthKeeping,
  backupsIn,
  BackupError,
  countDifferences,
  dumpKey,
  expired,
  MANIFEST_SUFFIX,
  manifestKeyOf,
  MAX_DUMP_BYTES,
  prefixOf,
  scratchName,
  staleness,
} from "./plan.mjs";

const CONTENT_TYPE = "application/octet-stream";

/**
 * @typedef {object} Ports
 * @property {{ now(): Date }} clock
 * @property {(line: string) => void} log
 * @property {{ serverMajor(): Promise<number>, withSnapshot<T>(use: (snapshotId: string, counts: Record<string, number>) => Promise<T>): Promise<T> }} source
 * @property {{ clientMajor(): Promise<number>, dump(snapshotId: string): Promise<string>, encrypt(plainPath: string, recipient: string): Promise<string>, remove(path: string): Promise<void> }} tools
 * @property {{ create(name: string): Promise<void>, restore(name: string, dumpPath: string): Promise<void>, count(name: string): Promise<Record<string, number>>, drop(name: string): Promise<void> }} scratch
 * @property {{ read(path: string): Promise<Uint8Array>, sha256(bytes: Uint8Array): string }} files
 * @property {{ residency: string, provider: object | null, store: import("@krizaka/storage").ObjectStore | null }} destination
 */

/** One nightly run. Throws a BackupError (the entry point prints it and exits 1); the scratch database and local files are always cleaned. */
export async function runBackup(ports, { environment, recipient, retentionDays }) {
  const { clock, log, source, tools, scratch, files, destination } = ports;
  const age = assertRecipient(recipient);
  // Everything that can refuse, refuses before the first byte is dumped.
  const { provider, store, residency } = destination;
  if (!provider || !store)
    throw new BackupError(
      "NO_DESTINATION",
      "no backup destination: an admin sets a default provider for « backups » (Administration → Storage)",
    );
  assertDestination(provider, residency);
  assertDumpClient(await source.serverMajor(), await tools.clientMajor());

  const startedAt = clock.now();
  const key = dumpKey(environment, startedAt);
  const leftovers = [];
  const scratchDb = scratchName(startedAt);
  let scratchCreated = false;
  try {
    const { plainPath, counts } = await source.withSnapshot(async (snapshotId, snapshotCounts) => {
      assertWorthKeeping(snapshotCounts);
      const path = await tools.dump(snapshotId);
      leftovers.push(path);
      return { plainPath: path, counts: snapshotCounts };
    });
    log(`dumped ${Object.keys(counts).length} tables`);

    // The drill: restore into a scratch database and compare every table's count with the snapshot's.
    await scratch.create(scratchDb);
    scratchCreated = true;
    await scratch.restore(scratchDb, plainPath);
    const differences = countDifferences(counts, await scratch.count(scratchDb));
    if (differences.length > 0) {
      const listed = differences.map((d) => `${d.table} ${d.source}→${d.restored}`).join(", ");
      throw new BackupError(
        "DRILL_MISMATCH",
        `the restore drill found ${differences.length} table(s) that differ: ${listed}`,
      );
    }
    log("restore drill passed: every table has the same row count");

    const encryptedPath = await tools.encrypt(plainPath, age);
    leftovers.push(encryptedPath);
    const encrypted = await files.read(encryptedPath);
    if (encrypted.byteLength === 0 || encrypted.byteLength > MAX_DUMP_BYTES)
      throw new BackupError(
        "DUMP_SIZE",
        `the encrypted dump is ${encrypted.byteLength} bytes (1 to ${MAX_DUMP_BYTES}): above the limit the store port needs streaming (@krizaka/storage)`,
      );
    if (!new TextDecoder().decode(encrypted.subarray(0, AGE_HEADER.length)).startsWith(AGE_HEADER))
      throw new BackupError("NOT_ENCRYPTED", "the file to upload is not an age file: refusing to send a plain dump");
    const sha256 = files.sha256(encrypted);

    await store.put(key, encrypted, { contentType: CONTENT_TYPE });
    const back = await store.get(key);
    if (!back || files.sha256(back.bytes) !== sha256)
      throw new BackupError(
        "UPLOAD_MISMATCH",
        `the object read back from the destination differs from what was sent: ${key}`,
      );
    log(`uploaded ${key} (${encrypted.byteLength} bytes, sha256 ${sha256.slice(0, 12)}…)`);

    const manifest = {
      key,
      createdAt: startedAt.toISOString(),
      environment,
      sha256,
      bytes: encrypted.byteLength,
      encryption: "age",
      rowCounts: counts,
      drill: "passed",
      providerId: provider.id,
      region: provider.coordinates?.region ?? null,
    };
    await store.put(manifestKeyOf(key), new TextEncoder().encode(JSON.stringify(manifest, null, 2)), {
      contentType: "application/json",
    });

    const deleted = await prune(store, environment, clock.now(), retentionDays);
    log(`retention: ${deleted} old backup(s) removed`);
    return manifest;
  } finally {
    for (const path of leftovers) await tools.remove(path).catch(() => {});
    if (scratchCreated)
      await scratch.drop(scratchDb).catch((error) => log(`could not drop ${scratchDb}: ${error.message}`));
  }
}

/** Applies the retention policy; returns how many backups (dump + manifest) were removed. */
export async function prune(store, environment, now, retentionDays) {
  const old = expired(backupsIn(await store.list(prefixOf(environment)), environment), now, retentionDays);
  for (const dump of old) {
    await store.delete(dump);
    await store.delete(manifestKeyOf(dump));
  }
  return old.length;
}

/** The dead-man's switch: throws when the newest backup is missing or older than the limit. Returns the newest key. */
export async function checkFresh(store, environment, now) {
  const backups = backupsIn(await store.list(prefixOf(environment)), environment);
  const stale = staleness(backups, now);
  if (stale) throw stale;
  const manifest = await store.head(manifestKeyOf(backups[0].key));
  if (!manifest)
    throw new BackupError("NO_MANIFEST", `the newest backup has no manifest (${MANIFEST_SUFFIX}): ${backups[0].key}`);
  return backups[0].key;
}
