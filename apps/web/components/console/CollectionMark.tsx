import { PackIcon } from "@krizaka/icons";
import type { CollectionAvatar as Avatar_ } from "@verikora/core";

import type { TagColor } from "@/lib/organisation/rules";

import { CollectionAvatar } from "./CollectionAvatar";

const TILE = {
  sm: "grid size-6 shrink-0 place-items-center rounded-md bg-surface-2",
  md: "grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2",
  lg: "grid size-12 shrink-0 place-items-center rounded-lg bg-surface-2",
} as const;
const GLYPH = { sm: 14, md: 20, lg: 24 } as const;

/**
 * A collection's mark: the picture the person chose, or a place mark (`PackIcon`) in the text colour of the collection's first
 * tag (≥ 4.5:1 in both themes), `fg-secondary` without a tag. Decoration only: the tag chips beside it name the colour.
 */
export function CollectionMark({
  id,
  name,
  avatar,
  size = "md",
  tag = null,
}: Readonly<{ id: string; name: string; avatar: Avatar_ | null; size?: "sm" | "md" | "lg"; tag?: TagColor | null }>) {
  if (avatar) {
    return <CollectionAvatar id={id} name={name} avatar={avatar} size={size} />;
  }
  return (
    <span
      aria-hidden
      data-testid="place-mark"
      className={tag ? TILE[size] : [TILE[size], "text-fg-secondary"].join(" ")}
      style={tag ? { color: `var(--kz-tag-${tag}-text)` } : undefined}
    >
      <PackIcon size={GLYPH[size]} />
    </span>
  );
}
