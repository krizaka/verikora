import { beforeAll, describe, expect, it } from "vitest";

import { PERSONA_ERIC } from "../../../scripts/demo-documents/index.mjs";
import { CAST_MEMBER } from "../../../scripts/demo-seed/cast.mjs";
import { seedPersona } from "../../../scripts/demo-seed/seed.mjs";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { migrate, pool, query } from "./db";
import * as org from "./organisation/store";

/** The persona's seed against a real PostgreSQL: idempotent, resettable, one at a time per account, and the library shows the three collections with their counts. */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const messagesByLocale = { fr, en };
/** The seed is one transaction: it needs one connection, not the pool. */
const onOneConnection = async <T>(
  work: (q: (sql: string, values?: unknown[]) => Promise<unknown[]>) => Promise<T>,
): Promise<T> => {
  const client = await pool().connect();
  try {
    return await work((sql, values) => client.query(sql, values).then((r) => r.rows));
  } finally {
    client.release();
  }
};
const run = (email: string, options: { reset?: boolean; locale?: string } = {}) =>
  onOneConnection((q) => seedPersona(q, { persona: "eric", email, messagesByLocale, ...options }));
const expected = {
  "Immeuble Rosemont": 6,
  "Candidats — 4½ Villeray": 6,
  "Factures 2026": 4,
  "À classer": 0,
  "Archives 2025": 0,
};

describe.runIf(enabled)("the demo seed (Éric)", () => {
  beforeAll(async () => {
    await migrate();
  });

  it("seeds one account once even when two seeds run at the same time (the account's advisory lock)", async () => {
    const email = fresh();
    const [a, b] = await Promise.all([run(email), run(email)]);
    expect(a.owner).toBe(b.owner);
    expect(a.collections).toEqual(expected);
    expect(b.collections).toEqual(expected);
    expect(await snapshot(a.owner)).toEqual({
      documents: 16,
      analyses: PERSONA_ERIC.checked.length + PERSONA_ERIC.failed.length,
      collections: 6,
    });
  });
  const fresh = () => `eric-${Math.random().toString(36).slice(2)}@demo.yomizaka.test`;
  const snapshot = async (owner: string) => ({
    documents: (await query<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE owner_id = $1", [owner]))[0]!
      .n,
    analyses: (
      await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1",
        [owner],
      )
    )[0]!.n,
    collections: (
      await query<{ n: number }>("SELECT count(*)::int AS n FROM collections WHERE owner_id = $1", [owner])
    )[0]!.n,
  });

  it("shows the three collections with their counts in the persona's library", async () => {
    const email = fresh();
    const { owner } = await run(email);
    const overview = await org.overview(query, owner);
    const counts = Object.fromEntries(overview.flatMap((l) => l.collections.map((c) => [c.name, c.files])));
    for (const [name, n] of Object.entries(expected)) expect(counts[name], name).toBe(n);
    expect(PERSONA_ERIC.collections).toHaveLength(5);
    const checks = await query<{ run_id: string; blueprint_version: string | null; inputs: Record<string, string> }>(
      "SELECT a.run_id, a.blueprint_version, a.inputs FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1",
      [owner],
    );
    expect(checks).toHaveLength(PERSONA_ERIC.checked.length + PERSONA_ERIC.failed.length);
    for (const c of checks) {
      expect(c.run_id).toMatch(/^seeded-/);
      expect(c.blueprint_version).toBeNull();
      expect(c.inputs.seeded).toBe("true");
    }
    const [account] = await query<{ perspective: string | null; name: string | null }>(
      "SELECT perspective, name FROM accounts WHERE id = $1",
      [owner],
    );
    expect(account?.perspective).toBe("landlord");
    expect(account?.name).toBe(CAST_MEMBER.displayName);
  });

  it("keeps a name the person chose, and fills a missing one", async () => {
    const email = fresh();
    const { owner } = await run(email);
    await query("UPDATE accounts SET name = 'Éric R.' WHERE id = $1", [owner]);
    await run(email);
    expect((await query<{ name: string | null }>("SELECT name FROM accounts WHERE id = $1", [owner]))[0]?.name).toBe(
      "Éric R.",
    );
    await query("UPDATE accounts SET name = NULL WHERE id = $1", [owner]);
    await run(email);
    expect((await query<{ name: string | null }>("SELECT name FROM accounts WHERE id = $1", [owner]))[0]?.name).toBe(
      CAST_MEMBER.displayName,
    );
  });

  it("changes nothing on a re-run but puts the persona back on the side the cast defines, and starts over with reset", async () => {
    const email = fresh();
    const first = await run(email);
    const before = await snapshot(first.owner);
    // krizaka-internal#2289: Éric had been left on « tenant » on the shared dev database, where « Dossiers » is not offered (404 on www).
    await query("UPDATE accounts SET perspective = 'tenant' WHERE id = $1", [first.owner]);
    const again = await run(email);
    expect(again.owner).toBe(first.owner);
    expect(again.name).toBe(CAST_MEMBER.displayName);
    expect(again.collections).toEqual(expected);
    expect(await snapshot(first.owner)).toEqual(before);
    expect(
      (await query<{ perspective: string | null }>("SELECT perspective FROM accounts WHERE id = $1", [first.owner]))[0]
        ?.perspective,
    ).toBe("landlord");
    const reset = await run(email, { reset: true });
    expect(reset.collections).toEqual(expected);
    expect(await snapshot(first.owner)).toEqual(before);
  });

  it("takes the account's language for the collections' names", async () => {
    const { collections } = await run(fresh(), { locale: "en" });
    expect(Object.keys(collections).sort()).toEqual([
      "Archive 2025",
      "Candidates — 4½ Villeray",
      "Invoices 2026",
      "Rosemont building",
      "To file",
    ]);
  });

  // yomizaka#1968: the English web film was made on French fixtures, because a re-seed kept the account's first language.
  it("a reset takes the language asked for, a plain re-run keeps the person's", async () => {
    const email = fresh();
    await run(email, { locale: "fr" });
    const kept = await run(email, { locale: "en" });
    expect(Object.keys(kept.collections)).toContain("Immeuble Rosemont");
    const reset = await run(email, { locale: "en", reset: true });
    expect(Object.keys(reset.collections)).toContain("Rosemont building");
    expect(Object.keys(reset.collections)).not.toContain("Immeuble Rosemont");
  });
});
