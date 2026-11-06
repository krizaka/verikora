import { MAX_FILE_BYTES } from "@verikora/core";

import type { PreflightRules } from "./port";

/**
 * Verikora's pre-flight rules — data. The limits follow the product: a lease, an invoice or a contract is a PDF or a text
 * file of at most 10 MB. Photos (PNG, JPEG, HEIC) are accepted and cleaned by lib/images, then read by lib/ocr (ADR-0010); Word files (.docx, .odt) are accepted since verikora#229, after the archive guards (entries, size, ratio, macros).
 */
export const VERIKORA_RULES: PreflightRules = {
  maxBytes: MAX_FILE_BYTES,
  allowedKinds: ["pdf", "text", "png", "jpeg", "heic", "docx", "odt"],
  maxImagePixels: 40_000_000,
  maxPages: 200,
  maxArchiveEntries: 1000,
  maxArchiveBytes: 100 * 1024 * 1024,
  maxArchiveRatio: 100,
  pdfActiveNames: [
    "JavaScript",
    "JS",
    "Launch",
    "EmbeddedFile",
    "EmbeddedFiles",
    "OpenAction",
    "AA",
    "RichMedia",
    "XFA",
    "ImportData",
    "SubmitForm",
  ],
};
