import { DOCX_MIME, ODT_MIME } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { documentTypeLabel } from "./document-type-label";

describe("the type the admin documents table names", () => {
  it.each([
    ["application/pdf", "PDF"],
    ["text/plain", "TXT"],
    [DOCX_MIME, "DOCX"],
    [ODT_MIME, "ODT"],
  ])("names %s as %s, never another format's label", (mime, label) => expect(documentTypeLabel(mime)).toBe(label));
});
