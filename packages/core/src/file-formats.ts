/**
 * What a file format is, written once: its media types, its extensions, the family the settings name it by, whether the
 * authenticity Studio examines it, the extension its stored object gets, and whether an upload is stored as that type.
 * Every place that asked "is this a PDF?", "what do we call .docx?" or "which extension does the object get?" reads this
 * table (krizaka-internal#4320); a new format is one row here.
 */
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ODT_MIME = "application/vnd.oasis.opendocument.text";

/** The families the settings (`limits.allowedTypes`) name the formats by. */
export const FILE_FAMILY = { pdf: "pdf", text: "text", image: "image", word: "word" } as const;
export type FileFamilyName = (typeof FILE_FAMILY)[keyof typeof FILE_FAMILY];

export interface FileFormat {
  /** The media types it goes by; the first is the one it is stored and sent as. */
  readonly mimes: readonly string[];
  readonly extensions: readonly string[];
  /** The setting family it belongs to, or null when no setting names it. */
  readonly family: FileFamilyName | null;
  /** Whether the authenticity Studio examines the file itself. */
  readonly examinable: boolean;
  /** The extension of its stored object. */
  readonly storedAs: string;
  /** Whether an upload is accepted and stored as this type (photos are turned into a PDF first, ADR-0010). */
  readonly accepted: boolean;
}

export const FILE_FORMATS = {
  pdf: {
    mimes: ["application/pdf"],
    extensions: ["pdf"],
    family: FILE_FAMILY.pdf,
    examinable: true,
    storedAs: "pdf",
    accepted: true,
  },
  text: {
    mimes: ["text/plain"],
    extensions: ["txt", "text", "md"],
    family: FILE_FAMILY.text,
    examinable: false,
    storedAs: "txt",
    accepted: true,
  },
  docx: {
    mimes: [DOCX_MIME],
    extensions: ["docx"],
    family: FILE_FAMILY.word,
    examinable: true,
    storedAs: "docx",
    accepted: true,
  },
  odt: {
    mimes: [ODT_MIME],
    extensions: ["odt"],
    family: FILE_FAMILY.word,
    examinable: true,
    storedAs: "odt",
    accepted: true,
  },
  png: {
    mimes: ["image/png"],
    extensions: ["png"],
    family: FILE_FAMILY.image,
    examinable: false,
    storedAs: "png",
    accepted: false,
  },
  jpeg: {
    mimes: ["image/jpeg"],
    extensions: ["jpg", "jpeg"],
    family: FILE_FAMILY.image,
    examinable: false,
    storedAs: "jpg",
    accepted: false,
  },
  heic: {
    mimes: ["image/heic", "image/heif"],
    extensions: ["heic", "heif"],
    family: FILE_FAMILY.image,
    examinable: false,
    storedAs: "heic",
    accepted: false,
  },
  zip: {
    mimes: ["application/zip"],
    extensions: ["zip"],
    family: null,
    examinable: false,
    storedAs: "zip",
    accepted: false,
  },
} as const satisfies Record<string, FileFormat>;

/** A kind of file the table describes. */
export type FormatKind = keyof typeof FILE_FORMATS;

/** What an upload is accepted as: the stored type of each accepted format, in the table's order. */
export const ACCEPTED_TYPES = ["application/pdf", "text/plain", DOCX_MIME, ODT_MIME] as const;

/** The stored extension of an object whose type the table does not know. */
const UNKNOWN_EXTENSION = "bin";

const KINDS = Object.keys(FILE_FORMATS) as FormatKind[];
const formatOf = (kind: FormatKind): FileFormat => FILE_FORMATS[kind];

/** The kind a media type names (parameters such as `; charset=utf-8` ignored), or undefined. */
export function formatOfMime(mime: string): FormatKind | undefined {
  const bare = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return KINDS.find((kind) => formatOf(kind).mimes.includes(bare));
}

/** The kind a file name's extension names, or undefined. */
export function formatOfName(name: string): FormatKind | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? KINDS.find((kind) => formatOf(kind).extensions.includes(ext)) : undefined;
}

/** The kinds a setting family names. */
export const kindsOfFamily = (family: string): FormatKind[] => KINDS.filter((kind) => formatOf(kind).family === family);

/** The media type a kind is stored and sent as. */
export const mimeOfKind = (kind: FormatKind): string => FILE_FORMATS[kind].mimes[0];

/** The accepted media types of a setting family (`word` → .docx and .odt); none for a family that is not known. */
export const acceptedMimesOfFamily = (family: string): string[] =>
  kindsOfFamily(family)
    .filter((kind) => formatOf(kind).accepted)
    .map(mimeOfKind);

/** Whether the authenticity Studio examines a file of this media type. */
export const isExaminable = (mime: string): boolean => {
  const kind = formatOfMime(mime);
  return kind !== undefined && formatOf(kind).examinable;
};

/** The extension of the stored object of a file of this media type. */
export const storedExtension = (mime: string): string => {
  const kind = formatOfMime(mime);
  return kind ? formatOf(kind).storedAs : UNKNOWN_EXTENSION;
};

/** The accepted media type of a kind of file (a PDF, text, Word or OpenDocument file), or undefined when an upload is not accepted as it. */
export const acceptedMimeOfKind = (kind: string): (typeof ACCEPTED_TYPES)[number] | undefined =>
  ACCEPTED_TYPES.find((mime) => formatOfMime(mime) === kind);
