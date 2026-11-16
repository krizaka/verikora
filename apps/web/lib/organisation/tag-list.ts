import { dbWorkspaceStore, type Query as LayerQuery } from "@krizaka/organize";

import { KIND, WORKSPACE } from "../workspace/decl";
import { asTag } from "../workspace/tags";
import type { Query } from "./query";
import type { Tag } from "./tag";

/**
 * The library's one tag list (krizaka-internal#3994): a collection, a folder and a document of an account wear tags of the same list
 * (`organize.tag`, kind « document »; `@krizaka/organize` 0.6 `tagList`). Reads here; every write goes through the workspace layer
 * (`workspaceFor`), which audits it and holds the roles and the cap.
 */
export type ContainerKind = typeof KIND.collection | typeof KIND.folder;

/** The tags of many collections or folders of one account, by entity id (an entity without a tag is absent). */
export async function tagsOfContainers(
  q: Query,
  owner: string,
  kind: ContainerKind,
  ids: readonly string[],
): Promise<Map<string, Tag[]>> {
  const found = new Map<string, Tag[]>();
  if (ids.length === 0) {
    return found;
  }
  const store = dbWorkspaceStore(q as unknown as LayerQuery, WORKSPACE);
  const [list, links] = await Promise.all([store.tags(owner, kind), store.tagsOf(kind, ids)]);
  const byId = new Map(list.map((tag) => [tag.id, asTag(tag)]));
  for (const [entity, tagIds] of links) {
    const tags = tagIds.flatMap((id) => byId.get(id) ?? []);
    if (tags.length > 0) {
      found.set(entity, tags);
    }
  }
  return found;
}

/** The library's list: what a collection, a folder or a document of the account is offered. */
export async function libraryTags(q: Query, owner: string): Promise<Tag[]> {
  const list = await dbWorkspaceStore(q as unknown as LayerQuery, WORKSPACE).tags(owner, KIND.document);
  return list.map(asTag);
}
