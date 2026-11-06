import type { SearchHit } from "@verikora/core";

import { query } from "./db";

/**
 * Search across one's documents — their titles and text, and the findings Sovkora returned on them. PostgreSQL full text
 * (`simple` configuration: French and English alike, no stemming guesses), passages cut by ts_headline around the words,
 * everything else escaped. A finding is searched in the latest successful run of each check on a document: a re-run replaces
 * the earlier one in the results instead of piling up duplicates. The query is the person's words, parsed by websearch_to_tsquery (quotes, OR, -word).
 */
const START = "\u0002";
const STOP = "\u0003";

/** Escapes a passage for HTML, then turns the markers ts_headline put around a match into <b>…</b>. */
export function passageHtml(raw: string): string {
  const escaped = raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return escaped.split(START).join("<b>").split(STOP).join("</b>").replace(/\s+/g, " ").trim();
}

export function normaliseQuery(q: string): string {
  return Array.from(q, (c) => ((c.codePointAt(0) ?? 0) < 32 ? " " : c))
    .join("")
    .trim()
    .slice(0, 200);
}

export async function search(ownerId: string, q: string): Promise<SearchHit[]> {
  const words = normaliseQuery(q);
  if (words.length < 2) {
    return [];
  }
  const options = `StartSel=${START}, StopSel=${STOP}, MaxWords=28, MinWords=10, MaxFragments=1`;
  const rows = await query<{
    document_id: string;
    title: string;
    kind: SearchHit["kind"];
    source: SearchHit["source"];
    passage: string;
    rank: number;
  }>(
    `WITH q AS (SELECT websearch_to_tsquery('simple', $2) AS tsq)
     SELECT * FROM (
       SELECT d.id AS document_id, d.title, d.kind,
              CASE WHEN to_tsvector('simple', d.title) @@ q.tsq THEN 'title' ELSE 'text' END AS source,
              ts_headline('simple', CASE WHEN d.text = '' THEN d.title ELSE d.text END, q.tsq, $3) AS passage,
              ts_rank(d.search, q.tsq) AS rank
         FROM documents d, q WHERE d.owner_id = $1 AND d.search @@ q.tsq
       UNION ALL
       SELECT d.id, d.title, d.kind, 'finding', ts_headline('simple', a.search_text, q.tsq, $3), ts_rank(to_tsvector('simple', a.search_text), q.tsq) * 0.9
         FROM analyses a JOIN documents d ON d.id = a.document_id, q
        WHERE d.owner_id = $1 AND a.status = 'succeeded' AND to_tsvector('simple', a.search_text) @@ q.tsq
          AND a.id = (SELECT l.id FROM analyses l WHERE l.document_id = a.document_id AND l.studio = a.studio AND l.status = 'succeeded' ORDER BY l.created_at DESC, l.id DESC LIMIT 1)
     ) hits ORDER BY rank DESC LIMIT 30`,
    [ownerId, words, options],
  );
  return rows.map((r) => ({
    documentId: r.document_id,
    title: r.title,
    kind: r.kind,
    source: r.source,
    passage: passageHtml(r.passage),
    rank: Number(r.rank),
  }));
}
