import pg from "pg";

/** A throw-away database for the integration tests that migrate from scratch (needs a database URL in the environment); dropped when `body` ends. */
export interface ScratchDatabase {
  pool: pg.Pool;
  /** The connection factory `migrate` of @krizaka/db takes. */
  connect: () => Promise<{ query: (text: string, values?: unknown[]) => Promise<pg.QueryResult>; release: () => void }>;
}

export async function withScratchDatabase<T>(prefix: string, body: (db: ScratchDatabase) => Promise<T>): Promise<T> {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const name = `${prefix}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  const connect: ScratchDatabase["connect"] = async () => {
    const client = await pool.connect();
    return { query: (text, values) => client.query(text, values), release: () => client.release() };
  };
  try {
    return await body({ pool, connect });
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE ${name}`);
    await admin.end();
  }
}
