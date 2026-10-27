import { randomUUID } from "node:crypto";

import type { Connection } from "@krizaka/db";
import pg from "pg";

/** A throwaway database on the test server (`DATABASE_URL`'s), for a test that runs the migrations up to a point, writes old-shaped rows, then runs the rest. */
export interface ScratchDatabase {
  /** What `@krizaka/db`'s runner takes. */
  connect: () => Promise<Connection>;
  /** One statement's rows. */
  run: (text: string, values?: unknown[]) => Promise<never>;
  pool: pg.Pool;
}

/** Creates the database, gives it to `work`, and always drops it. */
export async function withScratchDatabase<T>(prefix: string, work: (db: ScratchDatabase) => Promise<T>): Promise<T> {
  const serverUrl = process.env["DATABASE_URL"]!;
  const admin = new pg.Pool({ connectionString: serverUrl, max: 1 });
  const name = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const connect = async () => {
    const client = await pool.connect();
    return { query: (text: string, values?: unknown[]) => client.query(text, values), release: () => client.release() };
  };
  try {
    return await work({ connect, run: async (text, values) => (await pool.query(text, values)).rows as never, pool });
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}
