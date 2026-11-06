/**
 * Which file of the Mac a document of the server came from: the signed report is saved next to it. Only the path is
 * remembered, here, on this Mac; the document itself is never kept by the server.
 */
export interface PathStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "verikora.local-documents";
// @fixed: a Mac that has checked this many documents remembers the latest ones
const MAX_REMEMBERED = 500;

export function createLocalDocuments(store: PathStore) {
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(store.getItem(KEY) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  };
  return {
    remember(documentId: string, path: string): void {
      const all = { ...read(), [documentId]: path };
      const kept = Object.fromEntries(Object.entries(all).slice(-MAX_REMEMBERED));
      try {
        store.setItem(KEY, JSON.stringify(kept));
      } catch {
        // Storage refused: the report is then saved in a folder of the library.
      }
    },
    pathOf(documentId: string): string | null {
      return read()[documentId] ?? null;
    },
  };
}

export const localDocuments = createLocalDocuments({
  getItem: (key) => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
});
