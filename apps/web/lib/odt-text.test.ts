import { randomBytes } from "node:crypto";

import { ACCEPTED_TYPES, ODT_MIME } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { runInputs } from "./analyses";
import { checkUpload } from "./documents";
import { odtText } from "./docx-text";
import { readText } from "./pdf-text";
import { zipOf } from "./preflight/fixtures";
import { createInspector, sniff, zipEntries } from "./preflight/inspector";
import { VERIKORA_RULES } from "./preflight/rules";

const MIME = "application/vnd.oasis.opendocument.text";
const CONTENT = `<?xml version="1.0"?><office:document-content xmlns:office="office" xmlns:text="text">
<office:body><office:text>
<text:h text:outline-level="1">BAIL DE LOGEMENT</text:h>
<text:p>Loyer : <text:span>1 250 $</text:span><text:tab />par mois<text:line-break/>(Montr&#233;al)</text:p>
<text:p>Article 2 &amp; annexes &#x2014; &lt;texte&gt;</text:p>
</office:text></office:body></office:document-content>`;
const odt = (extra: { name: string; data: Buffer }[] = []) =>
  zipOf([
    { name: "mimetype", data: Buffer.from(MIME), stored: true },
    { name: "content.xml", data: Buffer.from(CONTENT) },
    ...extra,
  ]);

describe("an OpenDocument text file (verikora#229)", () => {
  it("is recognised by its mimetype entry, not its filename or an XML part alone", async () => {
    expect(ODT_MIME).toBe(MIME);
    expect(ACCEPTED_TYPES).toContain(MIME);
    expect(sniff(odt())).toBe("odt");
    expect(sniff(zipOf([{ name: "mimetype", data: Buffer.from(MIME) }]))).toBe("odt");
    expect(sniff(zipOf([{ name: "content.xml", data: Buffer.from(CONTENT) }]))).toBe("zip");
    expect(
      sniff(zipOf([{ name: "mimetype", data: Buffer.from("application/vnd.oasis.opendocument.spreadsheet") }])),
    ).toBe("zip");
    const inspector = createInspector(VERIKORA_RULES);
    expect(await inspector.inspect(odt(), { name: "bail.odt", type: MIME })).toMatchObject({
      kind: "accepted",
      fileKind: "odt",
      pages: null,
    });
    expect(await inspector.inspect(odt(), { name: "bail", type: MIME })).toMatchObject({
      kind: "accepted",
      fileKind: "odt",
    });
    expect(await inspector.inspect(Buffer.from("not an archive"), { name: "bail.odt", type: MIME })).toMatchObject({
      kind: "rejected",
      reason: "TYPE_MISMATCH",
    });
  });

  it("still applies the archive guards and workspace file restrictions", async () => {
    const inspector = createInspector(VERIKORA_RULES);
    expect(
      await inspector.inspect(odt([{ name: "word/vbaProject.bin", data: Buffer.from("x") }]), {
        name: "bail.odt",
        type: MIME,
      }),
    ).toMatchObject({ kind: "rejected", reason: "ACTIVE_CONTENT" });
    expect(
      await inspector.inspect(odt([{ name: "large.xml", data: Buffer.alloc(1024 * 1024) }]), {
        name: "bail.odt",
        type: MIME,
      }),
    ).toMatchObject({ kind: "rejected", reason: "ARCHIVE_BOMB" });
    expect(
      await createInspector({ ...VERIKORA_RULES, maxArchiveEntries: 1 }).inspect(odt(), {
        name: "bail.odt",
        type: MIME,
      }),
    ).toMatchObject({ kind: "rejected", reason: "ARCHIVE_BOMB" });
    expect(
      await createInspector({ ...VERIKORA_RULES, allowedKinds: ["pdf", "text"] }).inspect(odt(), {
        name: "bail.odt",
        type: MIME,
      }),
    ).toMatchObject({ kind: "rejected", reason: "UNSUPPORTED_TYPE" });
  });

  it("refuses OpenDocument's native macros, scripts and embedded script declarations", async () => {
    const inspector = createInspector(VERIKORA_RULES);
    for (const name of ["Basic/Standard/Module1.xml", "Scripts/python/macro.py"]) {
      expect(
        await inspector.inspect(odt([{ name, data: Buffer.from("macro") }]), { name: "bail.odt", type: MIME }),
      ).toMatchObject({ kind: "rejected", reason: "ACTIVE_CONTENT" });
    }
    const bytes = zipOf([
      { name: "mimetype", data: Buffer.from(MIME), stored: true },
      {
        name: "content.xml",
        data: Buffer.from(
          '<office:document-content><office:scripts><office:script script:language="ooo:Basic">macro</office:script></office:scripts><text:p>Lease</text:p></office:document-content>',
        ),
      },
    ]);
    expect(await inspector.inspect(bytes, { name: "bail.odt", type: MIME })).toMatchObject({
      kind: "rejected",
      reason: "ACTIVE_CONTENT",
    });
    const empty = zipOf([
      { name: "mimetype", data: Buffer.from(MIME), stored: true },
      {
        name: "content.xml",
        data: Buffer.from("<office:document-content><office:scripts/><text:p>Lease</text:p></office:document-content>"),
      },
    ]);
    expect(await inspector.inspect(empty, { name: "bail.odt", type: MIME })).toMatchObject({
      kind: "accepted",
      fileKind: "odt",
    });
  });

  it("fails closed when the main XML cannot be inspected within its bound", async () => {
    const bytes = Buffer.from(
      zipOf([
        { name: "content.xml", data: randomBytes(256 * 1024) },
        { name: "mimetype", data: Buffer.from(MIME), stored: true },
      ]),
    );
    const directory = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(21 * 1024 * 1024, directory + 24);
    expect(await createInspector(VERIKORA_RULES).inspect(bytes, { name: "bail.odt", type: MIME })).toMatchObject({
      kind: "rejected",
      reason: "CORRUPT",
    });
    const missing = zipOf([{ name: "mimetype", data: Buffer.from(MIME), stored: true }]);
    expect(await createInspector(VERIKORA_RULES).inspect(missing, { name: "bail.odt", type: MIME })).toMatchObject({
      kind: "rejected",
      reason: "CORRUPT",
    });
  });

  it("reads headings, paragraphs, spans, tabs, breaks and entities, without layout whitespace", () => {
    expect(odtText(odt())).toBe(
      "BAIL DE LOGEMENT\nLoyer : 1 250 $\tpar mois\n(Montréal)\nArticle 2 & annexes — <texte>\n",
    );
  });

  it("uses central-directory offsets even when content.xml is not the first part", () => {
    expect(
      odtText(
        zipOf([
          { name: "unused.xml", data: Buffer.from("<text:p>Not the document</text:p>") },
          { name: "content.xml", data: Buffer.from(CONTENT) },
        ]),
      ),
    ).toBe(odtText(odt()));
    expect(odtText(zipOf([{ name: "content.xml", data: Buffer.from(CONTENT), stored: true }]))).toBe(odtText(odt()));
  });

  it("keeps empty paragraphs and ignores markup outside the text, without resolving external entities", () => {
    const xml =
      '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><office:meta>Hidden</office:meta><text:p/><text:h>Title</text:h><text:p>&secret;</text:p>';
    expect(odtText(zipOf([{ name: "content.xml", data: Buffer.from(xml) }]))).toBe("\nTitle\n&secret;\n");
  });

  it("keeps the rest of a paragraph after a nested footnote", () => {
    const xml =
      "<text:p>Rent is <text:note><text:note-body><text:p>Monthly rent</text:p></text:note-body></text:note>1250 per month; utilities excluded.</text:p>";
    expect(odtText(zipOf([{ name: "content.xml", data: Buffer.from(xml) }]))).toContain(
      "1250 per month; utilities excluded.\n",
    );
  });

  it("separates footnote citations and bodies from adjacent amounts", () => {
    const xml =
      "<text:p>Rent 1250<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>Monthly</text:p></text:note-body></text:note> per month.</text:p>";
    expect(odtText(zipOf([{ name: "content.xml", data: Buffer.from(xml) }]))).toBe(
      "Rent 1250\n\n1\nMonthly\n\n per month.\n",
    );
  });

  it("omits deleted tracked-change history and keeps explicit spaces between words", () => {
    const xml =
      '<text:tracked-changes><text:changed-region><text:deletion><text:p>Rent is 2000.</text:p></text:deletion></text:changed-region></text:tracked-changes><text:p>Rent<text:s text:c="2"/>1250</text:p>';
    expect(odtText(zipOf([{ name: "content.xml", data: Buffer.from(xml) }]))).toBe("Rent 1250\n");
  });

  it("reads no text for a missing, truncated or oversized main part", () => {
    expect(odtText(zipOf([{ name: "mimetype", data: Buffer.from(MIME) }]))).toBe("");
    expect(odtText(odt().subarray(0, 40))).toBe("");
    expect(odtText(zipOf([{ name: "content.xml", data: Buffer.alloc(21 * 1024 * 1024) }]))).toBe("");
  });

  it("bounds inflation even when the directory understates the main part's size", () => {
    const bytes = Buffer.from(zipOf([{ name: "content.xml", data: Buffer.alloc(21 * 1024 * 1024) }]));
    const entry = zipEntries(bytes)![0]!;
    const directory = 30 + Buffer.byteLength(entry.name) + entry.compressed;
    bytes.writeUInt32LE(1, directory + 24);
    expect(odtText(bytes)).toBe("");
  });

  it("reaches persistence, compliance text and authenticity through the existing upload path", async () => {
    const bytes = odt();
    expect(await checkUpload({ name: "bail.odt", type: MIME, size: bytes.length }, bytes)).toMatchObject({
      mimeType: MIME,
      pages: null,
    });
    const read = await readText(ODT_MIME, bytes);
    expect(read).toEqual({
      text: "BAIL DE LOGEMENT\nLoyer : 1 250 $ par mois\n(Montréal)\nArticle 2 & annexes — <texte>",
      pages: null,
    });
    expect(
      runInputs(
        { studio: "compliance-check", jurisdiction: "QC" },
        { mimeType: MIME, text: read.text, content: Buffer.from(bytes) },
      ),
    ).toMatchObject({ document: read.text });
    expect(
      runInputs({ studio: "document-authenticity" }, { mimeType: MIME, text: read.text, content: Buffer.from(bytes) }),
    ).toEqual({ documentBase64: Buffer.from(bytes).toString("base64") });
  });
});
