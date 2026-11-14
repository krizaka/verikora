import { isId, parseTagsParam, TAG_COLORS, tagsHref, toggleTag, type TagColor } from "@krizaka/organize/contract";

import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from "./vocabulary";

type DocumentKind = (typeof DOCUMENT_KINDS)[number];
type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** The pure rules of the organisation (ADR-0007): names, tag colours, the `tags` filter, the paths, the delete choice. */
// @fixed: the length of the name columns and of the field in the UI
export const NAME_MAX = 80;
export { isId, parseTagsParam, TAG_COLORS, tagsHref, toggleTag, type TagColor };

/** The filters of a library view: all of them live in the URL (`?tags=…&kind=…&status=…`), so back, forward, refresh and a shared link keep them. */
export interface ViewState {
  tags: string[];
  kind: DocumentKind | null;
  status: DocumentStatus | null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseLibraryView(search: {
  tags?: string | string[];
  kind?: string | string[];
  status?: string | string[];
}): ViewState {
  const kind = one(search.kind);
  const status = one(search.status);
  return {
    tags: parseTagsParam(search.tags),
    kind: (DOCUMENT_KINDS as readonly string[]).includes(kind ?? "") ? (kind as DocumentKind) : null,
    status: (DOCUMENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as DocumentStatus) : null,
  };
}

export function libraryViewHref(path: string, view: ViewState): string {
  const query = [
    view.tags.length ? `tags=${view.tags.join(",")}` : "",
    view.kind ? `kind=${view.kind}` : "",
    view.status ? `status=${view.status}` : "",
  ]
    .filter(Boolean)
    .join("&");
  return query ? `${path}?${query}` : path;
}

/** Keeps the documents that match the kind and the status asked for (the tags are filtered in SQL). */
export function applyFilters<T extends { kind: string; status: string }>(docs: readonly T[], view: ViewState): T[] {
  return docs.filter((d) => (!view.kind || d.kind === view.kind) && (!view.status || d.status === view.status));
}
