import { DOCX_MIME, ODT_MIME } from "@verikora/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMITS,
  limitsFromConfig,
  mimeTypeOf,
  type PickedFile,
  PREFLIGHT_REASON,
  preflight,
} from "./preflight";

const pdf: PickedFile = { uri: "file:///bail.pdf", name: "bail.pdf", mimeType: "application/pdf", size: 120_000 };

describe("the limits the server answers", () => {
  it("names the types by family: they become the MIME types the picker reports, unknown ones dropped", () => {
    expect(limitsFromConfig({ maxFileBytes: 10, allowedTypes: ["pdf", "text", "docx"] })).toEqual({
      maxFileBytes: 10,
      allowedTypes: ["application/pdf", "text/plain"],
    });
  });

  it("accepts a .docx the server's `word` family allows, as the web does", () => {
    const limits = limitsFromConfig({ maxFileBytes: 1_000_000, allowedTypes: ["pdf", "word"] });
    const docx: PickedFile = { uri: "file:///bail.docx", name: "bail.docx", mimeType: null, size: 1000 };
    expect(preflight(docx, limits)).toEqual({ ok: true, file: { ...docx, mimeType: DOCX_MIME } });
    expect(limits.allowedTypes).toContain(ODT_MIME);
  });
});

describe("the type of a file the picker did not type", () => {
  it.each([
    ["Bail.PDF", null, "application/pdf"],
    ["notes.txt", null, "text/plain"],
    ["a.docx", null, DOCX_MIME],
    ["a.odt", null, ODT_MIME],
    ["scan.heic", null, null],
    ["noext", null, null],
    ["a.pdf", "text/plain", "text/plain"],
  ])("reads %s (%s) as %s", (name, reported, expected) => expect(mimeTypeOf(name, reported)).toBe(expected));

  it("lets an untyped PDF through and refuses an untyped image", () => {
    expect(preflight({ ...pdf, mimeType: null }).ok).toBe(true);
    expect(preflight({ ...pdf, name: "scan.heic", mimeType: null })).toEqual({
      ok: false,
      reason: PREFLIGHT_REASON.unsupportedType,
    });
  });
});

describe("the pre-flight of a picked file", () => {
  it("lets a PDF through", () => {
    expect(preflight(pdf)).toEqual({ ok: true, file: pdf });
  });

  it("lets a PDF through when the size is not known yet", () => {
    expect(preflight({ ...pdf, size: null }).ok).toBe(true);
  });

  it.each([
    ["an empty file", { size: 0 }, PREFLIGHT_REASON.empty],
    ["a file over the limit", { size: DEFAULT_LIMITS.maxFileBytes + 1 }, PREFLIGHT_REASON.tooLarge],
    ["a type the checks do not read", { mimeType: "image/png" }, PREFLIGHT_REASON.unsupportedType],
  ])("refuses %s", (_, change, reason) => {
    expect(preflight({ ...pdf, ...change })).toEqual({ ok: false, reason });
  });

  it("follows the limits the server answered, never more than the types it can read", () => {
    expect(preflight({ ...pdf, size: 2_000 }, { maxFileBytes: 1_000, allowedTypes: ["application/pdf"] })).toEqual({
      ok: false,
      reason: PREFLIGHT_REASON.tooLarge,
    });
    expect(preflight(pdf, { maxFileBytes: 1_000_000, allowedTypes: ["text/plain"] })).toEqual({
      ok: false,
      reason: PREFLIGHT_REASON.unsupportedType,
    });
    expect(
      preflight({ ...pdf, mimeType: "image/png" }, { maxFileBytes: 1_000_000, allowedTypes: ["image/png"] }).ok,
    ).toBe(false);
  });
});
