import { DOCX_MIME } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { docxText, ODT_TOKENS } from "./docx-text";
import { readText } from "./pdf-text";
import { docx, zipOf } from "./preflight/fixtures";
import { createInspector } from "./preflight/inspector";
import { VERIKORA_RULES } from "./preflight/rules";

const LEASE = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
<w:p><w:r><w:t>BAIL DE LOGEMENT</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Loyer : 1 250 $ </w:t></w:r><w:r><w:t>par mois</w:t></w:r><w:r><w:tab/><w:t>(Montr&#233;al)</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="end"/><w:t>Article 2 &amp; annexes</w:t></w:r></w:p>
</w:body></w:document>`;
const lease = () =>
  docx([]).length &&
  zipOf([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/document.xml", data: Buffer.from(LEASE) },
  ]);

describe("a Word file (verikora#229)", () => {
  it("its text: one paragraph per line, tabs and entities kept, field codes and markup dropped", () => {
    expect(
      docxText(lease() as Uint8Array)
        .trim()
        .split("\n"),
    ).toEqual(["BAIL DE LOGEMENT", "Loyer : 1 250 $ par mois\t(Montréal)", "Article 2 & annexes"]);
  });

  it("reaches the checks through readText, normalised like a PDF's text", async () => {
    const read = await readText(DOCX_MIME, lease() as Uint8Array);
    expect(read).toEqual({
      text: "BAIL DE LOGEMENT\nLoyer : 1 250 $ par mois (Montréal)\nArticle 2 & annexes",
      pages: null,
    });
  });

  it("is accepted by the pre-flight; a macro-bearing one is still refused", async () => {
    const inspector = createInspector(VERIKORA_RULES);
    expect(await inspector.inspect(lease() as Uint8Array, { name: "bail.docx", type: DOCX_MIME })).toMatchObject({
      kind: "accepted",
      fileKind: "docx",
    });
    expect(
      await inspector.inspect(docx([{ name: "word/vbaProject.bin", data: Buffer.from("x") }]), {
        name: "bail.docx",
        type: DOCX_MIME,
      }),
    ).toMatchObject({ kind: "rejected", reason: "ACTIVE_CONTENT" });
  });

  it("a file without its main part reads as no text, never as an error", () => {
    expect(docxText(zipOf([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") }]))).toBe("");
  });
});

describe("ODT_TOKENS", () => {
  it("is the pattern it was written as", () => {
    expect(ODT_TOKENS.source).toBe(
      /<(\/?)(text:(?:p|h|tracked-changes|s|tab|line-break|note|note-citation))(?=[\s/>])[^<>]*>|<[^<>]*>|([^<]+)/g
        .source,
    );
    expect(ODT_TOKENS.flags).toBe("g");
  });

  it("walks tags and runs the same way as that pattern", () => {
    const old =
      /<(\/?)(text:(?:p|h|tracked-changes|s|tab|line-break|note|note-citation))(?=[\s/>])[^<>]*>|<[^<>]*>|([^<]+)/g;
    const xml =
      '<text:p text:style-name="P1">Bail<text:s/> <text:tab/>de<text:line-break/>x</text:p><text:span>y</text:span><text:tracked-changes><text:p>z</text:p></text:tracked-changes><text:notes>n</text:notes><text:note-citation>1</text:note-citation>';
    const tokens = (re: RegExp) => [...xml.matchAll(re)].map((m) => [m.index, m[0], m[1], m[2], m[3]]);
    expect(tokens(ODT_TOKENS)).toEqual(tokens(old));
    expect(tokens(ODT_TOKENS).length).toBeGreaterThan(15);
  });
});
