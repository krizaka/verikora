import { type Avatar, storedAvatarKey } from "@krizaka/organize";
import { AVATAR_KIND, type CollectionAvatar } from "@verikora/core";

import type { DocumentStore } from "../storage/port";
import { guard, legacyAvatarKey, organizeOver } from "./organize";
import type { Query } from "./store";

/**
 * A collection's avatar (krizaka/verikora#206), now the package's (`@krizaka/organize`): one from the set the administrator allows, or an
 * uploaded image — checked by the pre-flight, made square with no metadata, kept behind the storage port. A new image is a new version.
 * Images stored before the package (`<owner>/<id>/<version>.jpg`) are still read; new ones are written under the package's key only.
 */
export interface AvatarRules {
  allowedSeeds: readonly string[];
  maxBytes: number;
  size: number;
}

/** The two keys an image avatar may live under: the package's (written) and the older one (read, deleted). */
export const avatarKeys = (owner: string, id: string, version: number) => [
  storedAvatarKey("collection", owner, id, version),
  legacyAvatarKey("collection", owner, id, version),
];

/** Deletes a stored image under both formats (when its collection goes). */
export const forgetAvatarImage = async (
  store: DocumentStore | undefined,
  owner: string,
  id: string,
  avatar: CollectionAvatar | null,
) => {
  if (!store || avatar?.kind !== AVATAR_KIND.image) return;
  for (const key of avatarKeys(owner, id, avatar.version)) await store.delete(key).catch(() => undefined);
};

const withStore = (q: Query, store: DocumentStore | undefined, maxBytes = 0, size = 256) =>
  organizeOver(q, store ? { store } : undefined, maxBytes, size);

/** An avatar from the set, or none (`null`). A seed outside the allowed set is refused; a stored image it replaces is deleted. */
export const setSetAvatar = (
  q: Query,
  owner: string,
  id: string,
  seed: string | null,
  allowed: readonly string[],
  store?: DocumentStore,
): Promise<void> => guard(() => withStore(q, store).collections.setAvatar(owner, id, seed, { allowedSeeds: allowed }));

export const uploadAvatar = (
  q: Query,
  owner: string,
  id: string,
  file: { name: string; type: string; bytes: Uint8Array },
  deps: AvatarRules & { store: DocumentStore },
): Promise<CollectionAvatar> =>
  guard(
    () =>
      withStore(q, deps.store, deps.maxBytes, deps.size).collections.uploadAvatar(owner, id, file, {
        maxBytes: deps.maxBytes,
      }) as Promise<Avatar>,
  ) as Promise<CollectionAvatar>;

/** The image of an image avatar (null for a set avatar or none). */
export const readAvatar = (q: Query, owner: string, id: string, store: DocumentStore) =>
  guard(() => withStore(q, store).collections.readAvatar(owner, id));

/** Back to no avatar; a stored image is deleted. */
export const removeAvatar = (q: Query, owner: string, id: string, store?: DocumentStore): Promise<void> =>
  guard(() => withStore(q, store).collections.removeAvatar(owner, id));
