import { describe, expect, it } from "vitest";

import {
  BATCH_ITEM_STATES,
  BATCH_TEMPLATE,
  detectDelimiter,
  matchBatchFiles,
  parseCsv,
  readBatchManifest,
  writeBatchManifest,
} from "./batch";

describe("a batch manifest (verikora#232)", () => {
  it("reads RFC 4180: quotes, doubled quotes, separators and line breaks inside quotes, CRLF, a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n"line\nbreak",z\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["line\nbreak", "z"],
    ]);
  });

  it("finds the separator a spreadsheet used (a French Excel writes ;)", () => {
    expect(detectDelimiter("file;check;reference")).toBe(";");
    expect(detectDelimiter("file\tcheck")).toBe("\t");
    expect(detectDelimiter("file,check")).toBe(",");
    const fr = readBatchManifest(
      "Fichier;Vérification;Émetteur attendu;Dossier\nbail.pdf;Authenticité;Agence Dupont;Laurier",
    );
    expect(fr.missingColumns).toEqual([]);
    expect(fr.rows[0]).toMatchObject({
      file: "bail.pdf",
      request: { studio: "document-authenticity", expectedIssuer: "Agence Dupont" },
      collection: "Laurier",
      errors: [],
    });
  });

  it("reads the template: one compliance and one authenticity row, both valid", () => {
    const m = readBatchManifest(BATCH_TEMPLATE);
    expect(m.missingColumns).toEqual([]);
    expect(m.rows.map((r) => [r.line, r.request?.studio, r.errors])).toEqual([
      [2, "compliance-check", []],
      [3, "document-authenticity", []],
    ]);
    expect(m.rows[0]).toMatchObject({ documentType: "lease", reference: "LOC-0012", collection: "Immeuble Laurier" });
    expect(m.rows[1]!.request).toEqual({ studio: "document-authenticity", expectedIssuer: "Employeur inc." });
  });

  it("columns are read by name, in any order and case; a missing required one and an unknown one are said", () => {
    const m = readBatchManifest("Reference,CHECK,Notes\nA-1,authenticity,hello");
    expect(m.missingColumns).toEqual(["file"]);
    expect(m.unknownColumns).toEqual(["Notes"]);
  });

  it("each row is held to the single check's rules, with the line a person looks for", () => {
    const m = readBatchManifest(
      [
        "file,check,jurisdiction,documentType,ruleset",
        "a.pdf,compliance,XX,lease,",
        ",authenticity,,,",
        "c.pdf,audit,,,",
        "d.pdf,compliance,FR,lease,qc-invoice",
        "e.pdf,compliance,qc,poster,",
        "a.pdf,compliance,QC,lease,",
      ].join("\n"),
    );
    expect(m.rows.map((r) => [r.line, r.errors])).toEqual([
      [2, ["INVALID_OPTIONS"]],
      [3, ["MISSING_FILE"]],
      [4, ["UNKNOWN_CHECK"]],
      [5, ["INVALID_OPTIONS"]],
      [6, ["UNKNOWN_DOCUMENT_TYPE"]],
      [7, ["DUPLICATE_ROW"]],
    ]);
    expect(m.rows[4]!.request).toMatchObject({ studio: "compliance-check", jurisdiction: "QC" });
  });

  it("rows meet the files sent: a missing file is said on its row, a file no row names is listed", () => {
    const m = readBatchManifest("file,check\nBail.PDF,compliance\nmissing.pdf,authenticity");
    const { rows, unnamedFiles } = matchBatchFiles(m, ["bail.pdf", "extra.jpg"]);
    expect(rows.map((r) => r.errors)).toEqual([[], ["FILE_NOT_SENT"]]);
    expect(unnamedFiles).toEqual(["extra.jpg"]);
  });

  it("writes a manifest the parser reads back to the same rows, names with commas and quotes included", () => {
    const text = writeBatchManifest([
      { file: "bail, Dupont.pdf", check: "compliance", reference: 'LOC "12"' },
      { file: "talon.pdf", check: "authenticite" },
    ]);
    const m = readBatchManifest(text);
    expect(m.missingColumns).toEqual([]);
    expect(m.rows.map((r) => [r.file, r.request?.studio, r.reference, r.errors])).toEqual([
      ["bail, Dupont.pdf", "compliance-check", 'LOC "12"', []],
      ["talon.pdf", "document-authenticity", null, []],
    ]);
    expect(BATCH_ITEM_STATES).toEqual(["pending", "reused", "running", "done", "failed", "refused"]);
  });
});
