import { Avatar } from "@krizaka/ui/avatar";
import { AVATAR_KIND, type CollectionAvatar as Avatar_ } from "@verikora/core";

import { BRAND_ID } from "@/lib/brand";

/**
 * A collection's picture: one of the folder set (the UI draws the seed in the product's colours: a folder glyph, never a person), an uploaded image (its address carries the
 * version, so a new image is a new address), or — with none chosen — a tone derived from the collection itself, so a list is not
 * one colour. The same shape the Mac, iOS and Android apps read.
 */
export function CollectionAvatar({
  id,
  name,
  avatar,
  size = "md",
}: Readonly<{ id: string; name: string; avatar: Avatar_ | null; size?: "sm" | "md" | "lg" }>) {
  const initial = name.trim().charAt(0).toUpperCase() || "·";
  if (avatar?.kind === AVATAR_KIND.image)
    return <Avatar size={size} src={`/api/collections/${id}/avatar?v=${avatar.version}`} alt="" fallback={initial} />;
  return (
    <Avatar
      size={size}
      defaultAvatar={{ brand: BRAND_ID, kind: "folder", seed: avatar?.kind === AVATAR_KIND.set ? avatar.seed : id }}
      alt=""
      fallback={initial}
    />
  );
}
