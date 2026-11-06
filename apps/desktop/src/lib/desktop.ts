import { createFolders, keychainStorage, type Listing, type TauriBridge } from "@krizaka/app-desktop";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * The native side, typed. What every Krizaka Mac app shares (folders, drops, the Keychain, the menu, links) is
 * tauri-plugin-krizaka through @krizaka/app-desktop; Verikora's own commands are below. The page has no fs, no shell, no
 * opener: each call goes through the folder scope (a granted folder, or a file dropped on the window this session).
 */
export const bridge: TauriBridge = { invoke, listen };
export const folders = createFolders(bridge);
export const keychain = keychainStorage(bridge);
export { followLinks, setNativeMenu } from "@krizaka/app-desktop";

export interface DocumentBytes {
  name: string;
  mime: string;
  size: number;
  /** base64 */
  data: string;
}

export const verikoraNative = {
  /** A granted folder's documents (what a check reads) and its folders. */
  listDocuments: (path: string) => invoke<Listing>("list_documents", { path }),
  readDocument: (path: string) => invoke<DocumentBytes>("read_document", { path }),
  /** Writes the signed report next to its document; the path it was written to. */
  saveReport: (document: string, name: string, data: string) => invoke<string>("save_report", { document, name, data }),
};

/** The bytes of a base64 string, for a `Blob` part. */
export function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}

export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}
