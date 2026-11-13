import { audit } from "./audit";
import { query, transaction } from "./db";
import { refuse } from "./http";
import { REFUSED_LANGUAGES, type RefusedLanguage, type RefusedWords, validateRefusedWord } from "./report-contract";

/** The words a report may never use, per language: data, seeded by migration 0005, edited by the administration (krizaka-internal#3378). */
export { REFUSED_LANGUAGES, type RefusedLanguage, type RefusedWords };

type Actor = { id: string; email: string };

/** Every refused word of both languages: a report is checked against all of them whatever its language. */
export async function refusedWords(): Promise<string[]> {
  return (await query<{ word: string }>("SELECT word FROM report_refused_words ORDER BY word")).map((r) => r.word);
}

export async function listRefusedWords(): Promise<RefusedWords> {
  const rows = await query<{ language: RefusedLanguage; word: string }>(
    "SELECT language, word FROM report_refused_words ORDER BY word",
  );
  return {
    fr: rows.filter((r) => r.language === "fr").map((r) => r.word),
    en: rows.filter((r) => r.language === "en").map((r) => r.word),
  };
}

export async function addRefusedWord(
  actor: Actor,
  language: RefusedLanguage,
  input: string,
  headers?: Headers,
): Promise<string> {
  const checked = validateRefusedWord(input);
  if (!checked.ok) {
    throw refuse(422, "INVALID_WORD", "A refused word is one word or a short phrase");
  }
  const rows = await query(
    "INSERT INTO report_refused_words (language, word) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING word",
    [language, checked.word],
  );
  if (rows.length === 0) {
    throw refuse(409, "ALREADY_LISTED", "This word is already on the list");
  }
  await audit({
    action: "report_refused_word.added",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: null,
    detail: { language, word: checked.word },
    headers,
  });
  return checked.word;
}

/** Removes a word; the last one of a language stays (an empty list would let every verdict word through): the count and the delete share one row lock. */
export async function removeRefusedWord(
  actor: Actor,
  language: RefusedLanguage,
  input: string,
  headers?: Headers,
): Promise<void> {
  const word = input.trim().toLowerCase();
  await transaction(async (tx) => {
    const held = await tx<{ word: string }>("SELECT word FROM report_refused_words WHERE language = $1 FOR UPDATE", [
      language,
    ]);
    if (!held.some((r) => r.word === word)) {
      throw refuse(404, "NOT_FOUND", "No such word on the list");
    }
    if (held.length <= 1) {
      throw refuse(409, "LIST_EMPTY", "The list keeps at least one word");
    }
    await tx("DELETE FROM report_refused_words WHERE language = $1 AND word = $2", [language, word]);
  });
  await audit({
    action: "report_refused_word.removed",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: null,
    detail: { language, word },
    headers,
  });
}
