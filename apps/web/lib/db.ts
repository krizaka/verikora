import { type Connection, migrate as runMigrations, type Query, transaction as dbTransaction } from "@krizaka/db";
import pg from "pg";

import { seedConfig } from "./config-seed";
import { readEnv } from "./env";
import { MIGRATIONS } from "./migrations";

/**
 * One pool per process. TLS to the cluster is verified against its CA (DATABASE_CA_CERT) — never
 * `rejectUnauthorized: false`; the URL's `sslmode` is read here, not by the driver, so the rule is one place.
 */
export function poolConfig(source: Record<string, string | undefined> = process.env): pg.PoolConfig {
  const env = readEnv(source);
  return configFor(env, { variable: "DATABASE_URL", value: env.DATABASE_URL }, env.DATABASE_MAX_CONNECTIONS);
}

// @fixed: connections kept for session locks and migrations — a technical bound; the main pool is never touched by it
const SESSION_CONNECTIONS = 4;

/**
 * The pool of the work that must hold one backend for its whole life (session advisory locks: migrations, ticks, named locks).
 * It goes to DATABASE_DIRECT_URL when set — a transaction pooler such as PgBouncer hands the next statement to another backend, and
 * a session lock would be lost — and to DATABASE_URL otherwise.
 */
export function sessionPoolConfig(source: Record<string, string | undefined> = process.env): pg.PoolConfig {
  const env = readEnv(source);
  const direct = env.DATABASE_DIRECT_URL
    ? { variable: "DATABASE_DIRECT_URL", value: env.DATABASE_DIRECT_URL }
    : { variable: "DATABASE_URL", value: env.DATABASE_URL };
  return { ...configFor(env, direct, SESSION_CONNECTIONS), allowExitOnIdle: true };
}

/**
 * Reads a connection string. A bad one says WHICH variable is wrong and never shows any part of it: Node's `Invalid URL`
 * error keeps the rejected input, so it is dropped here, not rethrown (yomizaka#386).
 */
function parseDatabaseUrl(variable: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} is not a valid URL (expected postgresql://user:password@host:port/database)`);
  }
  if (!url.hostname) throw new Error(`${variable} has no host`);
  return url;
}

function configFor(
  env: ReturnType<typeof readEnv>,
  source: { variable: string; value: string | undefined },
  max: number,
): pg.PoolConfig {
  if (!source.value) throw new Error(`${source.variable} is not set`);
  const url = parseDatabaseUrl(source.variable, source.value);
  const mode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const tls = mode === "require" || mode === "verify-ca" || mode === "verify-full";
  return {
    connectionString: url.toString(),
    max,
    idleTimeoutMillis: 30_000,
    ...(tls ? { ssl: { ca: env.DATABASE_CA_CERT?.replaceAll(String.raw`\n`, "\n"), rejectUnauthorized: true } } : {}),
  };
}

const holder = globalThis as unknown as { __yomizakaPool?: pg.Pool };

export function pool(): pg.Pool {
  holder.__yomizakaPool ??= new pg.Pool(poolConfig());
  return holder.__yomizakaPool;
}

/** The main pool as a `Query` (`@krizaka/db`): the rows of one statement. Any Krizaka module takes it as it is. */
export async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool().query(text, values);
  return result.rows as T[];
}

/**
 * The unit of work: `@krizaka/db`'s transaction on the main pool. `run` is its `Query`, so a Krizaka module takes it as it is.
 * A failure rolls back and is rethrown; a failed rollback never masks it (an AggregateError, the original first).
 */
export async function transaction<T>(work: (run: Query) => Promise<T>): Promise<T> {
  return dbTransaction(() => connectionOf(pool()), work);
}

/** A pool's connection, seen as the `Connection` of `@krizaka/db` (its rows, its release). */
async function connectionOf(source: pg.Pool): Promise<Connection> {
  const client = await source.connect();
  return {
    query: (text, values) => client.query(text, values as unknown[] | undefined),
    release: () => client.release(),
  };
}

/** The history table and the lock key of every deployed database: `@krizaka/db`'s runner finds the same ones, so nothing is replayed. */
// @fixed: the advisory-lock key every deployed instance already takes; changing it would let two instances migrate at once
export const MIGRATION_LOCK_KEY = 73191;

/**
 * Applies the migrations not applied yet, one transaction each, under an advisory lock (two instances never race), then the
 * configuration rows from code (`lib/config-seed.ts`, idempotent): the database a caller gets is the schema AND what the code expects in it.
 */
export async function migrate(client?: pg.Pool): Promise<string[]> {
  const applied = await runMigrations(() => connectionOf(client ?? lockPool()), MIGRATIONS, {
    lockKey: MIGRATION_LOCK_KEY,
  });
  await seedConfig(
    async (text, values) => (await (client ?? pool()).query(text, values as unknown[] | undefined)).rows as never,
  );
  return applied;
}

/**
 * Runs `work` only if no other instance holds this advisory lock (session level, one connection): the job of a tick that two
 * instances must never do at once. `null` when the lock is held elsewhere.
 */
export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T | null> {
  return withLock("SELECT pg_try_advisory_lock($1) AS ok", "SELECT pg_advisory_unlock($1)", key, work);
}

/** The same for a lock named by a string (one batch, one document…): two callers of the same name never work at once. */
export async function withNamedLock<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  return withLock(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok",
    "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    name,
    work,
  );
}

/**
 * Locks (and migrations) live on their own small pool, on the direct URL: a holder keeps its connection for the whole of its work, and that work runs its queries on the
 * main pool — if both came from one pool, as many concurrent holders as it has connections would wait forever for a connection to
 * read with (yomizaka#266, review). Holders beyond the pool simply wait their turn for a lock connection.
 */
const lockHolder = globalThis as unknown as { __yomizakaLockPool?: pg.Pool };
const lockPool = (): pg.Pool => (lockHolder.__yomizakaLockPool ??= new pg.Pool(sessionPoolConfig()));

async function withLock<T>(
  lock: string,
  unlock: string,
  key: number | string,
  work: () => Promise<T>,
): Promise<T | null> {
  const conn = await lockPool().connect();
  try {
    const [row] = (await conn.query<{ ok: boolean }>(lock, [key])).rows;
    if (!row?.ok) return null;
    try {
      return await work();
    } finally {
      await conn.query(unlock, [key]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}

/** The same lock, but waits its turn instead of giving up: for work that must happen once and that every caller needs done (seeding). */
export async function withBlockingLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const conn = await lockPool().connect();
  try {
    await conn.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [name]);
    try {
      return await work();
    } finally {
      await conn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [name]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}
