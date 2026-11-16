import type { QueryResultRow } from "pg";

/** The query function the organisation's storage takes (the app's pool in production, a real PostgreSQL in the tests). */
export type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
