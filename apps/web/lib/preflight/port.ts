/**
 * The document PRE-FLIGHT port (ADR-0005). Generic on purpose — no import from this app, so another Krizaka product
 * (Folioviv) can lift the folder as a package. It decides, in-process and for nothing, whether a file deserves an engine run:
 * real type by magic bytes, integrity, safety, cheap metadata. Deduplication (a run already exists) is the application's
 * `ReuseStore`, because it needs its data. Nothing here executes or renders a file.
 */
export type FileKind = "pdf" | "text" | "png" | "jpeg" | "heic" | "docx" | "odt" | "zip" | "executable" | "unknown";

/** The rules, as DATA (lib/preflight/rules.ts): what is allowed and how big, never typed into the code that applies them. */
export interface PreflightRules {
  maxBytes: number;
  /** Kinds that may reach the engine. A detected kind that is not listed is refused as UNSUPPORTED_TYPE. */
  allowedKinds: readonly FileKind[];
  maxPages: number;
  /** Pixels an image may declare (width × height, read from its header): a decompression bomb is refused before any decoder runs. */
  maxImagePixels: number;
  /** Archive guards (DOCX is a zip): entries, total uncompressed bytes, and the compression ratio of any entry. */
  maxArchiveEntries: number;
  maxArchiveBytes: number;
  maxArchiveRatio: number;
  /** PDF names that mean active content: refused, never followed. */
  pdfActiveNames: readonly string[];
}

export type RejectReason =
  | "EMPTY"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "TYPE_MISMATCH"
  | "EXECUTABLE"
  | "CORRUPT"
  | "TRUNCATED"
  | "ENCRYPTED"
  | "TOO_MANY_PAGES"
  | "ACTIVE_CONTENT"
  | "ARCHIVE_BOMB"
  | "IMAGE_TOO_LARGE";

/** Facts a PDF carries that need no model (authenticity triage can start from them). */
export interface PdfFacts {
  producer: string | null;
  creator: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  /** Revisions appended after the first save (`%%EOF` markers − 1): a document edited after it was issued. */
  incrementalSaves: number;
}

/** The outcome kinds, as constants (compare to these, never to a string literal). */
export const OUTCOME = { accepted: "accepted", rejected: "rejected", reused: "reused" } as const;

export type Inspection =
  | { kind: "accepted"; fileKind: FileKind; sha256: string; pages: number | null; facts: PdfFacts | null }
  | { kind: "rejected"; reason: RejectReason; detail?: string };

export interface DocumentPreflight {
  /** `declared` is what the client claimed (name, MIME type): it is only compared with what the bytes are. */
  inspect(bytes: Uint8Array, declared: { name: string; type: string }): Promise<Inspection>;
}

/** What the application's outcome is: the inspection, or a result it already holds. */
export type PreflightOutcome = Inspection | { kind: "reused"; runId: string; analysisId: string };

/** Where an earlier result for the same bytes, tenant and rules version may be found (the application's data). */
export interface ReuseStore {
  find(query: {
    tenantId: string;
    sha256: string;
    studio: string;
    rulesKey: string;
  }): Promise<{ runId: string; analysisId: string } | null>;
}
