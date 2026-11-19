import { describe, expect, it } from "vitest";

import {
  ACCEPTED_TYPES,
  acceptedMimesOfFamily,
  DOCX_MIME,
  FILE_FORMATS,
  formatOfMime,
  formatOfName,
  isExaminable,
  kindsOfFamily,
  mimeOfKind,
  ODT_MIME,
  storedExtension,
} from "./file-formats";

describe("the file-format table", () => {
  it("accepts exactly the types of the formats marked accepted, in the table's order", () => {
    const fromTable = Object.values(FILE_FORMATS)
      .filter((f) => f.accepted)
      .map((f) => f.mimes[0]);
    expect([...ACCEPTED_TYPES]).toEqual(fromTable);
  });

  it("gives no extension or media type to two kinds", () => {
    const all = Object.values(FILE_FORMATS).flatMap((f) => [...f.mimes, ...f.extensions]);
    expect(new Set(all).size).toBe(all.length);
  });

  it.each([
    ["application/pdf", "pdf"],
    ["text/plain; charset=utf-8", "text"],
    [DOCX_MIME, "docx"],
    [ODT_MIME, "odt"],
    ["image/heif", "heic"],
    ["image/webp", "webp"],
    ["application/zip", "zip"],
    ["application/x-unknown", undefined],
  ])("reads the media type %s as %s", (mime, kind) => expect(formatOfMime(mime)).toBe(kind));

  it.each([
    ["Bail.PDF", "pdf"],
    ["notes.md", "text"],
    ["a.docx", "docx"],
    ["photo.JPG", "jpeg"],
    ["noext", undefined],
    ["a.exe", undefined],
  ])("reads the name %s as %s", (name, kind) => expect(formatOfName(name)).toBe(kind));

  it("names the kinds of a setting family, and the media types an upload accepts from it", () => {
    expect(kindsOfFamily("word")).toEqual(["docx", "odt"]);
    expect(kindsOfFamily("image")).toEqual(["png", "jpeg", "heic", "webp"]);
    expect(acceptedMimesOfFamily("word")).toEqual([DOCX_MIME, ODT_MIME]);
    expect(acceptedMimesOfFamily("image")).toEqual([]);
    expect(acceptedMimesOfFamily("nope")).toEqual([]);
    expect(mimeOfKind("heic")).toBe("image/heic");
  });

  it("examines a PDF, a Word and an OpenDocument file, not a text file or an unknown type", () => {
    expect(["application/pdf", DOCX_MIME, ODT_MIME].every(isExaminable)).toBe(true);
    expect(isExaminable("text/plain")).toBe(false);
    expect(isExaminable("application/x-unknown")).toBe(false);
  });

  it("stores each accepted type under its own extension, an unknown one as .bin", () => {
    expect(ACCEPTED_TYPES.map(storedExtension)).toEqual(["pdf", "txt", "docx", "odt"]);
    expect(storedExtension("application/x-unknown")).toBe("bin");
  });
});
