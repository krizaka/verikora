// The real ports of the backup: PostgreSQL (pg + pg_dump + pg_restore), age, the files and the admin-configured storage provider.
// Secrets arrive in the environment of the job and are never printed; the PostgreSQL password goes to the tools through their own
// environment variables (PGPASSWORD…), never a command line.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseVaultKey, residencyOfConfig } from "@krizaka/storage";
import { createProviderService, dbProviderStore } from "@krizaka/storage/provider-admin";
import pg from "pg";

import { BackupError, DATA_KIND_BACKUPS, majorOf } from "./plan.mjs";

const ORG_SCOPE = "org";
const VAULT_KEY_ID = "media-1";

/** Runs a program with its own environment; resolves with stdout, rejects with a BackupError that never contains the environment. */
function run(program, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => reject(new BackupError("TOOL_MISSING", `${program}: ${e.message}`)));
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new BackupError("TOOL_FAILED", `${program} exited ${code}: ${err.trim().slice(-600)}`)),
    );
  });
}

/** The connection of the job: the database URL (+ its CA) as pg options and as the libpq variables the tools read. */
export function connectionOf(env, caPath, database) {
  if (!env.DATABASE_URL) throw new BackupError("NO_DATABASE", "DATABASE_URL is not set");
  const url = new URL(env.DATABASE_URL);
  const name = database ?? decodeURIComponent(url.pathname.slice(1));
  const ssl = env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT, rejectUnauthorized: true } : undefined;
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const libpq = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: name,
    ...(caPath ? { PGSSLMODE: "verify-full", PGSSLROOTCERT: caPath } : {}),
  };
  return {
    options: { host: url.hostname, port: Number(url.port || 5432), user, password, database: name, ssl },
    libpq,
  };
}

const TABLES =
  "SELECT n.nspname AS schema, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' ORDER BY 1, 2";

async function countTables(client) {
  const counts = {};
  for (const { schema, name } of (await client.query(TABLES)).rows) {
    const qualified = `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(name)}`;
    counts[`${schema}.${name}`] = Number(
      (await client.query(`SELECT count(*)::text AS n FROM ${qualified}`)).rows[0].n,
    );
  }
  return counts;
}

/** All the ports for a real run. `close()` removes the temporary folder and ends the pool. */
export async function realPorts(env) {
  const dir = await mkdtemp(join(tmpdir(), "verikora-backup-"));
  const caPath = env.DATABASE_CA_CERT ? join(dir, "ca.pem") : null;
  if (caPath) await writeFile(caPath, env.DATABASE_CA_CERT, { mode: 0o600 });
  const main = connectionOf(env, caPath);
  const pool = new pg.Pool({ ...main.options, max: 2 });
  const query = (text, params) => pool.query(text, params).then((r) => r.rows);
  const clock = { now: () => new Date() };

  const source = {
    serverMajor: async () => majorOf((await query("SHOW server_version"))[0].server_version),
    async withSnapshot(use) {
      const client = new pg.Client(main.options);
      await client.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const snapshot = (await client.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
        const counts = await countTables(client);
        return await use(snapshot, counts);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        await client.end();
      }
    },
  };

  const tools = {
    clientMajor: async () => majorOf(await run("pg_dump", ["--version"])),
    async dump(snapshotId) {
      const out = join(dir, "verikora.dump");
      await run(
        "pg_dump",
        ["--format=custom", "--no-owner", "--no-acl", `--snapshot=${snapshotId}`, `--file=${out}`],
        main.libpq,
      );
      return out;
    },
    async encrypt(plainPath, recipient) {
      const out = `${plainPath}.age`;
      await run("age", ["--recipient", recipient, "--output", out, plainPath]);
      return out;
    },
    remove: (path) => rm(path, { force: true }),
  };

  const scratch = {
    async create(name) {
      await query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
    },
    async restore(name, dumpPath) {
      await run(
        "pg_restore",
        ["--no-owner", "--no-acl", "--exit-on-error", `--dbname=${name}`, dumpPath],
        connectionOf(env, caPath, name).libpq,
      );
    },
    async count(name) {
      const client = new pg.Client(connectionOf(env, caPath, name).options);
      await client.connect();
      try {
        return await countTables(client);
      } finally {
        await client.end();
      }
    },
    async drop(name) {
      await query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
    },
  };

  const files = {
    read: async (path) => new Uint8Array(await readFile(path)),
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  };
  const destination = await destinationOf(env, query, clock);
  const close = async () => {
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  };
  return { ports: { clock, log: (line) => console.log(line), source, tools, scratch, files, destination }, close };
}

/** The admin's default provider for « backups »: its store, its record and where it is (never guessed in Canada's favour). */
export async function destinationOf(env, query, clock) {
  if (!env.MEDIA_VAULT_KEY)
    throw new BackupError("NO_VAULT_KEY", "the storage vault key is not set: the storage credentials cannot be opened");
  const vaultKey = parseVaultKey(env.MEDIA_VAULT_KEY);
  const service = createProviderService({
    store: dbProviderStore(query),
    vault: { keyId: VAULT_KEY_ID, key: vaultKey, ring: { keys: { [VAULT_KEY_ID]: vaultKey } } },
    clock,
    newId: randomUUID,
    audit: async () => {},
    open: { runtime: "server", environment: env.APP_ENVIRONMENT === "prod" ? "prod" : "dev", fetch, clock },
    probeId: randomUUID,
    references: async () => 0,
  });
  const opened = await service.openDefault(ORG_SCOPE, DATA_KIND_BACKUPS);
  if (!opened) return { provider: null, store: null, residency: "elsewhere" };
  const provider = (await service.list(ORG_SCOPE)).find((p) => p.id === opened.id) ?? null;
  const residency = provider
    ? residencyOfConfig({
        provider: provider.kind === "bunny" ? "http" : "s3",
        endpoint: provider.coordinates.endpoint ?? "",
        region: provider.coordinates.region ?? "",
      })
    : "elsewhere";
  return { provider, store: opened.store, residency };
}
