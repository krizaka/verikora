import zlib from "node:zlib";

import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

/** One generated file per case of the pre-flight (test fixtures; nothing here is a real document). */
export async function cleanPdf(text = "BAIL DE LOGEMENT (démonstration)"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { x: 50, y: 700, size: 12, font });
  doc.setProducer("Fixture");
  doc.setCreator("Fixture");
  return doc.save({ useObjectStreams: false });
}

/** A PDF whose catalogue runs JavaScript when opened. */
export async function javascriptPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const action = doc.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert('x')") });
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.register(action));
  return doc.save({ useObjectStreams: false });
}

/** A PDF with an action that launches a program from an annotation. */
export async function launchPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [0, 0, 10, 10],
    A: { S: "Launch", F: PDFString.of("calc.exe") },
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
  return doc.save({ useObjectStreams: false });
}

/** A PDF whose trailer declares encryption (the object tree is not read: the file is refused first). */
export async function encryptedPdf(): Promise<Uint8Array> {
  const clean = Buffer.from(await cleanPdf()).toString("latin1");
  return Buffer.from(
    clean.replace(/trailer\s*<<?/, (m) => `${m} /Encrypt << /Filter /Standard /V 1 /R 2 >> `),
    "latin1",
  );
}

export async function truncatedPdf(): Promise<Uint8Array> {
  const clean = await cleanPdf();
  return clean.subarray(0, Math.floor(clean.length * 0.6));
}

/** Right trailer, broken body: the file parses as a PDF header and trailer only. */
export async function corruptedPdf(): Promise<Uint8Array> {
  const clean = Buffer.from(await cleanPdf()).toString("latin1");
  const broken = clean.replaceAll("endobj", "ENDOBJ").replace(/(?<!\d)\d+ 0 obj/g, "x y obj");
  return Buffer.from(broken, "latin1");
}

/** A PDF edited after it was issued: a second revision appended. */
export async function incrementallySavedPdf(): Promise<Uint8Array> {
  const clean = await cleanPdf();
  return Buffer.concat([clean, Buffer.from("\n%appended revision\nstartxref\n0\n%%EOF\n", "latin1")]);
}

export const windowsExecutable = (): Uint8Array =>
  Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(200, 0x90)]);
import sharp from "sharp";

/** A real, tiny PNG or JPEG (white page): the cleaner decodes these. */
export async function imageOf(kind: "png" | "jpeg" | "webp"): Promise<Uint8Array> {
  const base = sharp({ create: { width: 64, height: 48, channels: 3, background: "#ffffff" } });
  const encode = { png: () => base.png(), jpeg: () => base.jpeg(), webp: () => base.webp() };
  return new Uint8Array(await encode[kind]().toBuffer());
}

const isoBox = (type: string, ...payload: Buffer[]): Buffer => {
  const body = Buffer.concat(payload);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length + 8);
  return Buffer.concat([size, Buffer.from(type), body]);
};

/** The signature of an HEIC file that declares no size (an « ftyp » box, brand heic, no « ispe »): the pre-flight refuses it. */
export const heicBytes = (): Uint8Array =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(80)]);

/** A HEIC header (ftyp, meta > iprp > ipco > ispe) that claims these dimensions: the pixel guard reads it, it never decodes. */
export function heicWithSize(width: number, height: number): Uint8Array {
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(width, 0);
  dims.writeUInt32BE(height, 4);
  const ispe = isoBox("ispe", Buffer.alloc(4), dims);
  const meta = isoBox("meta", Buffer.alloc(4), isoBox("iprp", isoBox("ipco", ispe)));
  return Buffer.concat([isoBox("ftyp", Buffer.from("heic"), Buffer.alloc(4)), meta]);
}

/** A PNG header that claims these dimensions (IHDR only): the pixel guard reads the header, it never decodes. */
export function pngWithSize(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from("IHDR"),
    ihdr,
    Buffer.alloc(8),
  ]);
}

/** A PNG signature with no IHDR: its size is unknown. */
export const pngBytes = (): Uint8Array =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

/** A minimal zip (stored directory entries of deflated content) — enough for the directory-only reads. */
export function zipOf(entries: { name: string; data: Buffer; stored?: boolean }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.stored ? e.data : zlib.deflateRawSync(e.data, { level: 9 });
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.stored ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(e.stored ? 0 : 8, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirBytes, end]);
}

export const docx = (extra: { name: string; data: Buffer }[] = []) =>
  zipOf([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/document.xml", data: Buffer.from("<w:document/>") },
    ...extra,
  ]);
/** A zip bomb: 60 MB of zeros that deflate to ~60 KB. */
export const zipBomb = () =>
  zipOf([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/document.xml", data: Buffer.alloc(60 * 1024 * 1024) },
  ]);
