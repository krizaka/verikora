import type { AvatarOption } from "@krizaka/ui/account-settings";

import { BRAND_ID } from "@/lib/brand";

/** The brand whose gradient the folder pictures wear. */
export const FOLDER_BRAND = BRAND_ID;

/**
 * The tiles of a folder's avatar picker: the administrator's seeds drawn as the FOLDER set of Krizaka UI (a folder glyph on the
 * product's gradient), never a person's silhouette (verikora#433). `label(n)` names the n-th tile for assistive technology.
 */
export function folderAvatarOptions(seeds: readonly string[], label: (n: number) => string): AvatarOption[] {
  return seeds.map((seed, i) => ({
    id: seed,
    label: label(i + 1),
    kind: "folder",
    defaultAvatar: { brand: FOLDER_BRAND, kind: "folder", seed },
  }));
}
