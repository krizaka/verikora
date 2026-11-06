import type { FolderEntry } from "@krizaka/app-desktop";

/**
 * A watched folder (« dossier surveillé »): a document that lands in it is checked without asking — the person turned it on
 * for that folder, and only for it. What is already there when it is turned on is never sent: only what arrives after.
 * Kept on this Mac only (the folders and the files seen, never a document's content).
 */
export interface InboxStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "verikora.inbox";
// @fixed: the names remembered per folder, enough for a year of leases, small enough for the page's storage
const MAX_SEEN = 2000;

type State = Record<string, string[]>;

export function createInbox(store: InboxStore) {
  const read = (): State => {
    try {
      const value = JSON.parse(store.getItem(KEY) ?? "{}") as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? (value as State) : {};
    } catch {
      return {};
    }
  };
  const write = (state: State) => {
    try {
      store.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage refused: the folder stops being watched at the next launch, nothing is sent by mistake.
    }
  };
  const files = (entries: readonly FolderEntry[]) => entries.filter((e) => !e.isDir).map((e) => e.path);
  return {
    isWatched: (folder: string) => folder in read(),
    watched: () => Object.keys(read()),
    /** Turns it on with what is there now marked as seen (never sent), or off. */
    set(folder: string, on: boolean, entries: readonly FolderEntry[] = []) {
      const state = read();
      if (on) state[folder] = files(entries).slice(-MAX_SEEN);
      else delete state[folder];
      write(state);
    },
    /** The documents that arrived since the last look, now marked as seen. Nothing for a folder that is not watched. */
    arrivals(folder: string, entries: readonly FolderEntry[]): FolderEntry[] {
      const state = read();
      const seen = state[folder];
      if (!seen) return [];
      const known = new Set(seen);
      const fresh = entries.filter((e) => !e.isDir && !known.has(e.path));
      if (fresh.length) {
        state[folder] = [...seen, ...fresh.map((e) => e.path)].slice(-MAX_SEEN);
        write(state);
      }
      return fresh;
    },
  };
}

export type Inbox = ReturnType<typeof createInbox>;
