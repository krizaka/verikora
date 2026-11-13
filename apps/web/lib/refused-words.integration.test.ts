import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate, pool, query } from "./db";
import { addRefusedWord, listRefusedWords, refusedWords, removeRefusedWord } from "./refused-words";

/** The refused-word list against a real PostgreSQL (see db.integration.test.ts for how to run it). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("the refused-word list", () => {
  const email = `words-${Date.now()}@verikora.test`;
  let actor: { id: string; email: string };
  beforeAll(async () => {
    await migrate();
    const [row] = await query<{ id: string }>(
      "INSERT INTO accounts (email, role, password_hash) VALUES ($1, 'ADMIN', 'x') RETURNING id",
      [email],
    );
    actor = { id: row!.id, email };
  });
  afterAll(async () => {
    await query("DELETE FROM accounts WHERE id = $1", [actor.id]);
    await pool().end();
  });

  it("is seeded in both languages", async () => {
    const list = await listRefusedWords();
    expect(list.en).toEqual(expect.arrayContaining(["fraud", "liar", "reject"]));
    expect(list.fr).toEqual(expect.arrayContaining(["fraude", "menteur", "rejeter"]));
    expect((await refusedWords()).length).toBe(list.en.length + list.fr.length);
  });

  it("adds a word, normalised, once, and removes it", async () => {
    expect(await addRefusedWord(actor, "en", "  Cheater ")).toBe("cheater");
    await expect(addRefusedWord(actor, "en", "cheater")).rejects.toMatchObject({ status: 409 });
    await expect(addRefusedWord(actor, "en", "")).rejects.toMatchObject({ status: 422 });
    expect(await refusedWords()).toContain("cheater");
    await removeRefusedWord(actor, "en", "cheater");
    expect(await refusedWords()).not.toContain("cheater");
    await expect(removeRefusedWord(actor, "en", "cheater")).rejects.toMatchObject({ status: 404 });
  });

  it("writes one audit line per change", async () => {
    await addRefusedWord(actor, "fr", "tricheur");
    await removeRefusedWord(actor, "fr", "tricheur");
    const rows = await query<{ action: string }>(
      "SELECT action FROM audit.entry WHERE action LIKE 'report_refused_word.%' AND detail->>'word' = 'tricheur' AND actor_id = $1 ORDER BY action",
      [actor.id],
    );
    expect(rows.map((r) => r.action)).toEqual(["report_refused_word.added", "report_refused_word.removed"]);
  });

  it("never lets two removals empty a language, whatever the order they arrive in", async () => {
    const seeded = (await listRefusedWords()).fr;
    try {
      await query("DELETE FROM report_refused_words WHERE language = 'fr' AND word NOT IN ('fraude', 'menteur')");
      await query(
        "INSERT INTO report_refused_words (language, word) VALUES ('fr', 'fraude'), ('fr', 'menteur') ON CONFLICT DO NOTHING",
      );
      const results = await Promise.allSettled([
        removeRefusedWord(actor, "fr", "fraude"),
        removeRefusedWord(actor, "fr", "menteur"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        results.filter((r) => r.status === "rejected" && (r.reason as { status: number }).status === 409),
      ).toHaveLength(1);
      const left = (await listRefusedWords()).fr;
      expect(left).toHaveLength(1);
      await expect(removeRefusedWord(actor, "fr", left[0]!)).rejects.toMatchObject({ status: 409 });
    } finally {
      for (const word of seeded) {
        await query("INSERT INTO report_refused_words (language, word) VALUES ('fr', $1) ON CONFLICT DO NOTHING", [
          word,
        ]);
      }
    }
  });
});
