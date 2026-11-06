# Disaster recovery — the database and the documents

Issue krizaka/verikora#513 (split from #17, ADR-0012). Code: `deploy/backup/`. Infrastructure: `deploy/digitalocean/dev.app.yaml`
(two scheduled jobs). Data stays in Canada (Loi 25).

## What is protected, and where it is

| What | Where it lives | Protected by |
| :--- | :--- | :--- |
| Metadata, extracted text, accounts, audit | Managed PostgreSQL (DigitalOcean `tor`) | the provider's own backups **and** our nightly encrypted dump below |
| A document's bytes | The admin's default provider for « documents » (ADR-0012, encrypted with the object key) | the provider's durability; versioning off by design (a purge must delete) |
| Keys | The vault (`MEDIA_VAULT_KEY`, `MEDIA_DOCUMENTS_ENCRYPTION_KEY`, the age **private** key) | an offline copy, outside the cloud account |

Losing `MEDIA_VAULT_KEY` loses the storage credentials; losing the object key loses every stored document; losing the age private
key loses every off-site dump. Keep an offline copy of each (two places, two people).

## The nightly backup (03:15 America/Toronto)

A scheduled job **inside the DigitalOcean app** (no IP rule to open: krizaka-infra#24) runs `deploy/backup/bin/backup.mjs`:

1. Opens one `REPEATABLE READ` snapshot, counts every table, and `pg_dump --format=custom --snapshot=…` of that same snapshot.
2. **Drill, every night**: restores the dump into a scratch database (`verikora_drill_<time>`), counts again, and compares every
   table. Any difference fails the run (`DRILL_MISMATCH`). The scratch database is always dropped.
3. Encrypts with `age` to a **public** key (`BACKUP_AGE_RECIPIENT`). A private key in the environment is refused
   (`PRIVATE_KEY_IN_ENV`); a file that is not an age file is never uploaded (`NOT_ENCRYPTED`).
4. Uploads to the admin's default provider for **« backups »** (Administration → Storage → « Use for the nightly backups »): it
   must be verified and in a Canadian region (`NOT_CANADA`, never a guess in Canada's favour). The object is read back and its
   SHA-256 compared (`UPLOAD_MISMATCH`), then a manifest (`…manifest.json`: SHA-256, size, row counts, drill result) is written.
5. Retention: copies older than 30 days are deleted, the newest 7 are **always** kept; names that are not ours are never touched.

A second job, `backup-freshness` (08:45), fails when the newest backup is missing or older than 36 hours (`NO_BACKUP`, `STALE`).
Every failure prints `BACKUP_FAILED <code> <reason>` and exits 1: it shows as a failed run in the app's job history. Copies are
named `backups/verikora/<env>/verikora-<env>-<UTC stamp>.dump.age`.

The server proves the dump **restores** and that the uploaded bytes are the encrypted ones; it cannot open them (the private key is
offline). Opening the encrypted copy is the quarterly drill below.

## Restore drill by hand (quarterly, and after any key change)

Needs: the age private key (offline), `age`, `pg_restore`, a **throwaway** PostgreSQL (never production), access to the destination.

```bash
# 1. fetch the newest copy and its manifest from the « backups » provider (with the provider's own tool; the console does not download backups)
# 2. verify the SHA-256 in the manifest
shasum -a 256 verikora-prod-<stamp>.dump.age          # must equal manifest.sha256
# 3. decrypt (the identity file stays on the offline machine)
age --decrypt --identity ~/offline/verikora-backup.key --output restore.dump verikora-prod-<stamp>.dump.age
# 4. restore into a scratch database and compare with the manifest's rowCounts
createdb verikora_drill && pg_restore --no-owner --no-acl --exit-on-error --dbname verikora_drill restore.dump
psql verikora_drill -Atc "select count(*) from documents"   # each table against manifest.rowCounts
dropdb verikora_drill && shred -u restore.dump 2>/dev/null || rm -f restore.dump
```

Record the date, the copy and the result in the quarterly checkpoint. A drill that cannot decrypt is an incident: rotate the key
pair the same day (below) and take a fresh backup.

## Restoring on a fresh instance

1. **Stop writes**: scale the web service to 0 (or put the app in maintenance). Never restore under a live service.
2. Create a new managed PostgreSQL (same major version or newer; `tor`), take its URL and CA.
3. Decrypt the newest good copy (steps 2–3 above), then `pg_restore --no-owner --no-acl --exit-on-error --dbname "$NEW_URL" restore.dump`.
4. Point the app at it: `DATABASE_URL` and `DATABASE_CA_CERT` of the app and of both jobs; the migrations run on start and are idempotent.
5. **Replay the purge**: a restore brings back rows the purge had emptied. Start the service, run the retention sweep (the server's
   background tick, `apps/web/lib/retention.ts`) and check `document.purged` is written again before reopening sign-in.
6. **Documents**: their bytes are in the store, not in the dump. If the store is intact, nothing to do; a document whose object is
   missing answers 404 and shows as such (re-upload). If the store provider changed, `documents.provider_id` still names the old
   provider: re-add it in Administration → Storage (same coordinates and keys) before opening.
7. Check: `/api/healthz`, sign in as a QA account, open a document, and check that a kept document opens.
8. Reopen, then write the incident note (what was lost: everything after the last backup, at most 24 h).

Recovery objectives: **RPO 24 h** (nightly), **RTO 4 h** for the database plus the DNS/app switch.

## Key custody and rotation

- The age **private** key is generated offline (`age-keygen -o verikora-backup.key`), kept in two offline places, and **only the
  public key** (`age1…`) is set as `BACKUP_AGE_RECIPIENT` (a SECRET placeholder in the app spec, filled at apply time).
- Rotation: generate a new pair, set the new public key, run the job once, and verify it with the hand drill using the **new**
  private key. Keep the old private key until the last copy encrypted to it has expired (30 days).
- The storage provider credentials are sealed in the database under `MEDIA_VAULT_KEY`: the destination of the backups is changed by
  the admin in the console (new provider → test → « Use for the nightly backups »), never in code.

## Things the founder applies (not done by an agent)

1. Create the second, independent destination in Canada (a bucket in a different provider or account than the documents') and add it
   in Administration → Storage, test it, and make it the default for « the nightly backups ».
2. Generate the age key pair offline; give the public key to the apply step (`__BACKUP_AGE_RECIPIENT__`) and `MEDIA_VAULT_KEY`
   (`__MEDIA_VAULT_KEY__`) to the jobs.
3. Apply `deploy/digitalocean/dev.app.yaml` (`krizaka-deploy`); the `doadmin` database user must be allowed `CREATE DATABASE` for
   the drill (or set a dedicated drill user on the cluster).
4. Run the job once by hand from the console, read `BACKUP_OK`, then do the hand drill once.

## Known limits

- The store port takes a whole object in memory: a dump above 200 MB fails loudly (`DUMP_SIZE`) until the package streams
  (`@krizaka/storage`).
- The documents' SHA-256 are not re-checked against the store by the nightly job (the bytes are not in the dump); the check is a
  follow-up in the document store's own sweep.
