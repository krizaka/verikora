import { STORAGE_MODE, STORAGE_MODES, type StorageMode } from "@yomizaka/core";

/**
 * The modes Settings > Storage offers as cards. A connected cloud is not one: it is connected from its own panel (an OAuth round trip),
 * so it has no card text; the person's own S3 needs an installation that can keep their credentials.
 */
export const storageCards = (canStoreCredentials: boolean): StorageMode[] => STORAGE_MODES.filter((m) => m !== STORAGE_MODE.cloud && (m !== STORAGE_MODE.s3 || canStoreCredentials));
