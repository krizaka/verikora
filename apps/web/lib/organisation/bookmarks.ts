/**
 * Bookmarks on the documents (verikora#339): the person's own tags of kind « document » read as a filter. Pure: the page loads the
 * ids and the tags of each, these rules say which documents remain — a document must wear **every** bookmark asked for (the same
 * rule as a place's `?tags=`), and a bookmark that no longer exists is ignored, never an empty list.
 */
export type BookmarkRef = { id: string };

/** The ids that wear all of `selected`, in their order. No bookmark asked for: all of them. */
export function wearingAll(
  ids: readonly string[],
  tagsByDocument: Readonly<Record<string, readonly BookmarkRef[]>>,
  selected: readonly string[],
): string[] {
  if (selected.length === 0) return [...ids];
  return ids.filter((id) => {
    const worn = new Set((tagsByDocument[id] ?? []).map((t) => t.id));
    return selected.every((s) => worn.has(s));
  });
}

/** What the address may ask for: only the bookmarks the person has (an id that was deleted or is not theirs falls away). */
export function knownBookmarks(selected: readonly string[], owned: readonly BookmarkRef[]): string[] {
  const own = new Set(owned.map((t) => t.id));
  return selected.filter((s) => own.has(s));
}

/** The bookmarks a document wears after one is applied (`on`) or lifted; never twice, the others untouched. */
export function withBookmark(worn: readonly string[], id: string, on: boolean): string[] {
  if (!on) return worn.filter((w) => w !== id);
  return worn.includes(id) ? [...worn] : [...worn, id];
}

type Color = "blue" | "green" | "amber" | "red" | "violet" | "gray";
/** The tab hues are the binder's tones; the word and the count say it too, the colour is never the only signal. */
const HUE = {
  blue: "accent",
  green: "success",
  amber: "warning",
  red: "danger",
  violet: "accent",
  gray: "neutral",
} as const;
export type DividerHue = (typeof HUE)[Color];

export interface Divider {
  /** The bookmark's id, or null for « All ». */
  id: string | null;
  name: string | null;
  hue: DividerHue;
  /** The documents that wear it (all of them for « All »), out of the ones the page holds. */
  count: number;
  href: string;
  on: boolean;
}

/**
 * The bookmarks as the binder's dividers (verikora#339): « All » then one tab per bookmark with the number of documents that wear it;
 * a tab opens that bookmark alone (`?tags=<id>`, the address is the state). The active tab is the one bookmark in force, « All » when none.
 */
export function dividers(input: {
  bookmarks: readonly { id: string; name: string; color: Color }[];
  ids: readonly string[];
  tagsByDocument: Readonly<Record<string, readonly BookmarkRef[]>>;
  selected: readonly string[];
  path: string;
}): Divider[] {
  const { bookmarks, ids, tagsByDocument, selected, path } = input;
  const only = selected.length === 1 ? selected[0] : null;
  const count = (tag: string) => wearingAll(ids, tagsByDocument, [tag]).length;
  return [
    { id: null, name: null, hue: "accent", count: ids.length, href: path, on: selected.length === 0 },
    ...bookmarks.map((b): Divider => ({
      id: b.id,
      name: b.name,
      hue: HUE[b.color],
      count: count(b.id),
      href: `${path}?tags=${b.id}`,
      on: only === b.id,
    })),
  ];
}
