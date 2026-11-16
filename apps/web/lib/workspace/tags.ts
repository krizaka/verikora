import type { WorkspaceTag } from "@krizaka/organize/contract";

import type { Tag } from "../organisation/tag";

/** The workspace's tag as the organisation screens read a tag: its marker is the colour name they already draw. */
export const asTag = (tag: Pick<WorkspaceTag, "id" | "name" | "marker">): Tag => ({
  id: tag.id,
  name: tag.name,
  color: tag.marker,
});

/** The tags of many entities as screens read them, by entity id. */
export const asTags = (byEntity: ReadonlyMap<string, readonly WorkspaceTag[]>): Record<string, Tag[]> =>
  Object.fromEntries([...byEntity].map(([id, tags]) => [id, tags.map(asTag)]));
