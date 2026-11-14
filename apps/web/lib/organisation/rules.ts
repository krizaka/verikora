import { cleanName } from "@krizaka/organize";
import { isId, NAME_MAX } from "@verikora/core";
import { z } from "zod";

import { refuse } from "../http";

/** The rules that need the HTTP layer; the pure ones (ids, tag colours, the filters) are `@verikora/core`'s, read by the apps too. */
export {
  applyFilters,
  isId,
  libraryViewHref,
  parseLibraryView,
  parseTagsParam,
  TAG_COLORS,
  type TagColor,
  tagsHref,
  toggleTag,
  type ViewState,
} from "@verikora/core";

/** The package's `cleanName`, refused over HTTP: an empty name and a name past `NAME_MAX` each say why. */
export function requiredName(raw: string): string {
  const name = cleanName(raw);
  if (name) return name;
  if (!raw.replace(/\s+/g, " ").trim()) throw refuse(400, "BAD_REQUEST", "A name is required");
  throw refuse(400, "BAD_REQUEST", `A name is at most ${NAME_MAX} characters`);
}

export function libraryPath(locale: string, library: string, collection?: string, folder?: string): string {
  return ["", locale, "app", "library", library, collection, collection ? folder : undefined]
    .filter((p) => p !== undefined)
    .join("/");
}

const choice = z.object({ files: z.enum(["move", "delete"]), to: z.string().nullish() });
export type DeleteChoice = { files: "delete" } | { files: "move"; to: string | null };

/** A deletion always states what becomes of the files: moved (to a collection; to the default collection, or up out of a folder, when `to` is null) or deleted. */
export function deleteChoice(input: unknown): DeleteChoice {
  const parsed = choice.safeParse(input);
  if (!parsed.success) throw refuse(400, "BAD_REQUEST", "Say what happens to the files: move or delete");
  if (parsed.data.files === "delete") return { files: "delete" };
  const to = parsed.data.to ?? null;
  if (to !== null && !isId(to)) throw refuse(400, "BAD_REQUEST", "Not a destination");
  return { files: "move", to };
}

/** Where a folder is once moved to each collection the person may choose: its new address (a collection whose library is unknown gives none). */
export function movedFolderHrefs(
  locale: string,
  collections: readonly { id: string; libraryId?: string }[],
  folderId: string,
): Record<string, string> {
  return Object.fromEntries(
    collections.flatMap((c) =>
      c.libraryId ? [[c.id, libraryPath(locale, c.libraryId, c.id, folderId)] as const] : [],
    ),
  );
}
