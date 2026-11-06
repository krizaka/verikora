import { BookmarkIcon } from "@krizaka/icons";
import type { CollectionAvatar as Avatar_ } from "@verikora/core";

import { CollectionAvatar } from "./CollectionAvatar";

const TILE = {
  sm: "grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-accent",
  md: "grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-accent",
  lg: "grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-accent",
} as const;
const GLYPH = { sm: 14, md: 20, lg: 24 } as const;

/**
 * A collection's mark: the picture the person chose, or a place mark in the brand's tint — never the account's default
 * person (the review's B1: a folder of leases is not a contact). krizaka-ui K4 brings a set of place marks; until then one.
 */
export function CollectionMark({
  id,
  name,
  avatar,
  size = "md",
}: Readonly<{ id: string; name: string; avatar: Avatar_ | null; size?: "sm" | "md" | "lg" }>) {
  if (avatar) return <CollectionAvatar id={id} name={name} avatar={avatar} size={size} />;
  return (
    <span aria-hidden data-testid="place-mark" className={TILE[size]}>
      <BookmarkIcon size={GLYPH[size]} />
    </span>
  );
}
