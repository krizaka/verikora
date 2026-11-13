import { z } from "zod";

import { requireAdmin } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { addRefusedWord, listRefusedWords, REFUSED_LANGUAGES, removeRefusedWord } from "@/lib/refused-words";

export const dynamic = "force-dynamic";

const body = z.object({ language: z.enum(REFUSED_LANGUAGES), word: z.string().max(80) });

/** The refused-word list of each language (krizaka-internal#3378). Admin only. */
export const GET = (req: Request) =>
  handle(async () => {
    await requireAdmin(req);
    return Response.json(await listRefusedWords(), { headers: { "Cache-Control": "private, no-store" } });
  });

/** Adds a word or a short phrase to a language's list. Audited. */
export const POST = (req: Request) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const { language, word } = await readJson(req, body);
    const added = await addRefusedWord(
      { id: session.account.id, email: session.account.email },
      language,
      word,
      req.headers,
    );
    return Response.json({ language, word: added }, { status: 201 });
  });

/** Removes a word; the last word of a language cannot be removed. Audited. */
export const DELETE = (req: Request) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const { language, word } = await readJson(req, body);
    await removeRefusedWord({ id: session.account.id, email: session.account.email }, language, word, req.headers);
    return Response.json({ ok: true });
  });
