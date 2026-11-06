import { MAX_OFFICE_PART_BYTES, zipEntryBytes } from "./preflight/inspector";

/**
 * The text of a Word file (.docx), read without a library and without a model (verikora#229): the main part
 * `word/document.xml`, its paragraphs one per line, its tabs and breaks kept, its markup and its fields' codes dropped.
 * The pre-flight already refused a bomb, a macro or an ActiveX control; the inflate is bounded again here.
 */
const DOCUMENT_PART = "word/document.xml";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) =>
    code[0] === "#"
      ? String.fromCodePoint(
          code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10),
        )
      : (ENTITIES[code] ?? whole),
  );

/** The ODF elements whose tags matter: paragraphs and headings, the tracked changes (history), spaces, tabs, breaks, notes. */
const ODT_TAGS = ["p", "h", "tracked-changes", "s", "tab", "line-break", "note", "note-citation"];

/** An ODF tag of those (captured with its closing slash and its name), any other tag, or a run of text: the three things `odtText` walks through. */
export const ODT_TOKENS = new RegExp(
  String.raw`<(\/?)(text:(?:${ODT_TAGS.join("|")}))(?=[\s/>])[^<>]*>|<[^<>]*>|([^<]+)`,
  "g",
);

/** What makes the text: a run's text, a tab, a break, the end of a paragraph — everything else (markup, layout whitespace) is not read. */
const TEXT_TOKENS = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g;

export function docxText(bytes: Uint8Array): string {
  // A field's code (« PAGE », « HYPERLINK … ») is not text a reader sees.
  const xml = (zipEntryBytes(bytes, DOCUMENT_PART, MAX_OFFICE_PART_BYTES)?.toString("utf8") ?? "").replace(
    /<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g,
    "",
  );
  let text = "";
  for (const [token, run] of xml.matchAll(TEXT_TOKENS)) {
    if (run !== undefined) text += decode(run);
    else if (token === "<w:tab/>") text += "\t";
    else text += "\n";
  }
  return text;
}

/** The depth of the tracked changes (history the reader never sees) after a tag: a closing one leaves, an open one enters, a self-closed one is nothing. */
function historyDepth(depth: number, closing: boolean, empty: boolean): number {
  if (closing) return Math.max(0, depth - 1);
  return empty ? depth : depth + 1;
}

/** The depth of open paragraphs after a tag: text is read only inside one. */
function paragraphDepth(depth: number, closing: boolean, empty: boolean): number {
  if (empty) return depth;
  return Math.max(0, depth + (closing ? -1 : 1));
}

/** What a tag or a run adds inside a paragraph: its text, a tab, a break, a space — a closing tag adds nothing. */
function inlineText(name: string | undefined, closing: boolean, run: string | undefined): string {
  if (run !== undefined) return decode(run);
  if (closing) return "";
  if (name === "text:tab") return "\t";
  if (name === "text:line-break") return "\n";
  return name === "text:s" ? " " : "";
}

const isBlock = (name: string | undefined) => name === "text:p" || name === "text:h";
const isNote = (name: string | undefined) => name === "text:note" || name === "text:note-citation";

/** OpenDocument's content.xml: headings and paragraphs, with inline text, tabs and line breaks kept. */
export function odtText(bytes: Uint8Array): string {
  const xml = zipEntryBytes(bytes, "content.xml", MAX_OFFICE_PART_BYTES)?.toString("utf8") ?? "";
  let text = "";
  let paragraphs = 0;
  let history = 0;
  for (const [token, closing, name, run] of xml.matchAll(ODT_TOKENS)) {
    const empty = token.endsWith("/>");
    if (name === "text:tracked-changes") {
      history = historyDepth(history, !!closing, empty);
      continue;
    }
    if (history) continue;
    if (isBlock(name)) {
      if (closing || empty) text += "\n";
      paragraphs = paragraphDepth(paragraphs, !!closing, empty);
    } else if (isNote(name)) {
      text += "\n";
    } else if (paragraphs) {
      text += inlineText(name, !!closing, run);
    }
  }
  return text;
}
