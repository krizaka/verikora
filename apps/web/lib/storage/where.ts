import { type StoreDescriptor as PackageDescriptor, where } from "@krizaka/storage";
import { STORAGE_KIND, type StorageKind } from "@verikora/core";

import type { DocumentStoreDescriptor } from "./port";

export { type NoticeKey, storageNotice } from "@krizaka/storage";

/**
 * The managed PostgreSQL where a document's bytes live today: DigitalOcean's Toronto region (deploy/digitalocean/dev.app.yaml,
 * next to the cluster), encrypted at rest by the provider. Not a configurable store: the legacy and current home of a document.
 */
const DATABASE: DocumentStoreDescriptor = {
  kind: "database",
  endpoint: null,
  region: "tor1",
  residency: "canada",
  encrypted: true,
  owner: "krizaka",
  devOnly: false,
};

/** The package says a store's kind as a string; this product's port names them (`StorageKind`, recorded with each document). */
export const asDescriptor = (d: PackageDescriptor): DocumentStoreDescriptor => ({ ...d, kind: d.kind as StorageKind });

/** The descriptor of a stored document, from its kind and the store configured now (the rules are `@krizaka/storage`'s `where`; the fixed place and the dev-only kind are this product's). */
export const storedAs = (kind: StorageKind, active: DocumentStoreDescriptor): DocumentStoreDescriptor =>
  asDescriptor(where(kind, active, { fixed: { [STORAGE_KIND.database]: DATABASE }, devOnly: [STORAGE_KIND.bunny] }));
