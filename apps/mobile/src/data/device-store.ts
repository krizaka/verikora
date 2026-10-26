import { assertKey, type DocumentStore, isId, STORAGE_KIND, STORAGE_OWNER, STORAGE_RESIDENCY, type StoreDescriptor } from "@yomizaka/core";

/** What the device store needs from the file system: the app's sandbox, never a path outside it. */
export interface FilePort {
  ensureDirectory(uri: string): void;
  /** Copies a file the person picked (a camera, a picker's cache) into the sandbox. */
  copy(from: string, to: string): void;
  write(uri: string, bytes: Uint8Array): void;
  /** The bytes of a file, or null when there is none. */
  read(uri: string): Uint8Array | null;
  /** The names of the files in a directory, empty when it does not exist yet. */
  names(directoryUri: string): string[];
  remove(uri: string): void;
}

/** What the info panel says of where the documents live. */
export const DEVICE_PLACE = { kind: STORAGE_KIND.device, owner: STORAGE_OWNER.device, residency: STORAGE_RESIDENCY.device } as const;

const DESCRIPTOR: StoreDescriptor = { kind: STORAGE_KIND.device, endpoint: null, region: null, residency: STORAGE_RESIDENCY.device, encrypted: false, owner: STORAGE_OWNER.device, devOnly: false };

/**
 * The `DocumentStore` port of ADR-0007 for the phone (yomizaka#155): objects live in the app's sandbox and nowhere else — the
 * files leave the device only for the one check that needs them, which the server purges. A key is one file whose name is the
 * key, percent-encoded, then `@` and the content type (`@` is never in an encoded name, so a key and a longer key stay two files).
 * It passes `documentStoreContract` like every adapter.
 */
export interface PhoneStore extends DocumentStore {
  /** Copies a picked file in under a key, without reading it into memory. */
  copyIn(key: string, sourceUri: string, contentType: string): void;
  /** Where the file of a key is (to share or open it), or null. */
  uriOf(key: string): string | null;
  /** The keys that start with a prefix. */
  keysWith(prefix: string): string[];
}

const SEPARATOR = "@";

export function createPhoneStore(files: FilePort, root: string): PhoneStore {
  const directory = `${root.replace(/\/$/, "")}/store`;
  const nameFor = (key: string, contentType: string) => `${encodeURIComponent(assertKey(key))}${SEPARATOR}${encodeURIComponent(contentType)}`;
  const entries = () => files.names(directory).map((name) => ({ name, key: decodeURIComponent(name.slice(0, name.indexOf(SEPARATOR))), contentType: decodeURIComponent(name.slice(name.indexOf(SEPARATOR) + 1)) }));
  const entryOf = (key: string) => entries().find((e) => e.key === assertKey(key));
  const drop = (key: string) => {
    const entry = entryOf(key);
    if (entry) files.remove(`${directory}/${entry.name}`);
  };
  return {
    async put(key, bytes, meta) {
      files.ensureDirectory(directory);
      drop(key);
      files.write(`${directory}/${nameFor(key, meta.contentType)}`, bytes);
    },
    async get(key) {
      const entry = entryOf(key);
      const bytes = entry ? files.read(`${directory}/${entry.name}`) : null;
      return entry && bytes ? { bytes, contentType: entry.contentType } : null;
    },
    async signedUrl() {
      return null;
    },
    async delete(key) {
      drop(key);
    },
    describe: () => DESCRIPTOR,
    copyIn(key, sourceUri, contentType) {
      files.ensureDirectory(directory);
      drop(key);
      files.copy(sourceUri, `${directory}/${nameFor(key, contentType)}`);
    },
    uriOf(key) {
      const entry = entryOf(key);
      return entry ? `${directory}/${entry.name}` : null;
    },
    keysWith: (prefix) => entries().map((e) => e.key).filter((k) => k.startsWith(prefix)),
  };
}

/** The extension of the kept copy, so the share sheet and the viewers know the type. */
export function extensionOf(name: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "bin";
}

const CONTENT_TYPES: Readonly<Record<string, string>> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", odt: "application/vnd.oasis.opendocument.text" };

/**
 * What the screens use: documents kept by the id the server gave them. The same store, under `documents/<id>.<extension>`: the file
 * stays in the app's sandbox, named by the id of the document the server knows, and leaves the device only for the one check that
 * needs it. The default of the app.
 */
export interface DeviceStore {
  keep(documentId: string, sourceName: string, sourceUri: string): void;
  uriOf(documentId: string): string | null;
  remove(documentId: string): Promise<void>;
  describe(): typeof DEVICE_PLACE;
}

const guard = (id: string): string => {
  if (!isId(id)) throw new Error("not a document id");
  return id;
};

export function createDeviceStore(files: FilePort, root: string): DeviceStore {
  const store = createPhoneStore(files, root);
  const keyOf = (id: string) => store.keysWith(`documents/${guard(id)}.`)[0];
  return {
    keep(documentId, sourceName, sourceUri) {
      const extension = extensionOf(sourceName);
      store.copyIn(`documents/${guard(documentId)}.${extension}`, sourceUri, CONTENT_TYPES[extension] ?? "application/octet-stream");
    },
    uriOf(documentId) {
      const key = keyOf(documentId);
      return key ? store.uriOf(key) : null;
    },
    async remove(documentId) {
      const key = keyOf(documentId);
      if (key) await store.delete(key);
    },
    describe: () => DEVICE_PLACE,
  };
}
