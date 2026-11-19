import { storedExtension } from "@verikora/core";

/** The short name of a document's format in the admin table: the extension its object is stored under, from the format table. */
export const documentTypeLabel = (mimeType: string): string => storedExtension(mimeType).toUpperCase();
