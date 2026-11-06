import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { zipEntries, zipEntryBytes } from "./preflight/inspector";
import { buildZip } from "./zip";

const at = new Date("2026-10-23T10:05:00Z");
const text = (s: string) => Buffer.from(s);

describe("the zip writer (verikora#242)", () => {
  it("reads back through the pre-flight's own zip reader: names, sizes and contents", () => {
    const csv = "line,file\r\n".repeat(200);
    const zip = buildZip([
      { name: "lot.csv", data: text(csv), modified: at },
      { name: "rapports/2-Étienne-fr.pdf", data: text("%PDF-1.7 not compressible: 9f8e7d6c5b4a"), modified: at },
    ]);
    const entries = zipEntries(zip)!;
    expect(entries.map((e) => e.name)).toEqual(["lot.csv", "rapports/2-Étienne-fr.pdf"]);
    expect(zipEntryBytes(zip, "lot.csv", 1 << 20)!.toString()).toBe(csv);
    expect(zipEntryBytes(zip, "rapports/2-Étienne-fr.pdf", 1 << 20)!.toString()).toBe(
      "%PDF-1.7 not compressible: 9f8e7d6c5b4a",
    );
    // the repeated CSV is deflated, the short file is copied as is
    expect(entries[0]!.compressed).toBeLessThan(entries[0]!.uncompressed);
    expect(entries[1]!.compressed).toBe(entries[1]!.uncompressed);
  });

  it("stores the CRC-32 of each file and flags names as UTF-8 (a French name survives every unzip)", () => {
    const zip = buildZip([{ name: "signaux/é.json", data: text('{"a":1}'), modified: at }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(14, true)).toBe(zlib.crc32(text('{"a":1}')));
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it("is deterministic: the same content gives the same bytes; an empty archive is still a zip", () => {
    const entries = [{ name: "a.txt", data: text("a"), modified: at }];
    expect(buildZip(entries).equals(buildZip(entries))).toBe(true);
    expect(zipEntries(buildZip([]))).toEqual([]);
  });
});
