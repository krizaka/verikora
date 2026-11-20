/**
 * The EXIF block of a HEIC file, found without decoding the image: HEIC is an ISO box file, its metadata an item typed `Exif`
 * listed in `iinf` and located by `iloc`. Returns the block as sharp gives it for a JPEG (`Exif\0\0` then the TIFF data), or
 * null when there is none or the file is not shaped as expected. Never throws: a photo with unreadable boxes has no facts.
 */
const EXIF_PREFIX = Buffer.from("Exif\0\0", "latin1");

type Box = { type: string; start: number; end: number; body: number };

function boxes(buf: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(buf.readBigUInt64BE(at + 8));
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) break;
    out.push({ type: buf.toString("latin1", at + 4, at + 8), start: at, end: at + size, body });
    at += size;
  }
  return out;
}

const uint = (buf: Buffer, at: number, size: number): number =>
  size === 0 ? 0 : size === 4 ? buf.readUInt32BE(at) : size === 8 ? Number(buf.readBigUInt64BE(at)) : buf.readUIntBE(at, size);

/** The id of the item whose type is `Exif`, from the `iinf` box. */
function exifItemId(buf: Buffer, iinf: Box): number | null {
  const version = buf[iinf.body]!;
  const first = iinf.body + 4 + (version === 0 ? 2 : 4);
  for (const infe of boxes(buf, first, iinf.end)) {
    if (infe.type !== "infe" || buf[infe.body]! < 2) continue;
    const wide = buf[infe.body]! >= 3;
    const at = infe.body + 4;
    const id = wide ? buf.readUInt32BE(at) : buf.readUInt16BE(at);
    const type = buf.toString("latin1", at + (wide ? 4 : 2) + 2, at + (wide ? 4 : 2) + 6);
    if (type === "Exif") return id;
  }
  return null;
}

/** The first extent of an item stored in the file itself, from the `iloc` box. */
function locate(buf: Buffer, iloc: Box, wanted: number): { offset: number; length: number } | null {
  const version = buf[iloc.body]!;
  let at = iloc.body + 4;
  const sizes = buf[at]!;
  const [offsetSize, lengthSize, baseSize, indexSize] = [sizes >> 4, sizes & 15, buf[at + 1]! >> 4, version > 0 ? buf[at + 1]! & 15 : 0];
  at += 2;
  const count = version < 2 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
  at += version < 2 ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const id = version < 2 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
    at += version < 2 ? 2 : 4;
    const method = version > 0 ? buf.readUInt16BE(at) & 15 : 0;
    at += version > 0 ? 2 : 0;
    at += 2; // data reference index
    const base = uint(buf, at, baseSize);
    at += baseSize;
    const extents = buf.readUInt16BE(at);
    at += 2;
    let found: { offset: number; length: number } | null = null;
    for (let e = 0; e < extents; e++) {
      at += indexSize;
      const offset = uint(buf, at, offsetSize);
      const length = uint(buf, at + offsetSize, lengthSize);
      at += offsetSize + lengthSize;
      found ??= { offset: base + offset, length };
    }
    if (id === wanted) return method === 0 ? found : null;
  }
  return null;
}

export function heicExif(bytes: Uint8Array): Buffer | null {
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = boxes(buf, 0, buf.length).find((b) => b.type === "meta");
    if (!meta) return null;
    const inner = boxes(buf, meta.body + 4, meta.end);
    const iinf = inner.find((b) => b.type === "iinf");
    const iloc = inner.find((b) => b.type === "iloc");
    if (!iinf || !iloc) return null;
    const id = exifItemId(buf, iinf);
    const place = id === null ? null : locate(buf, iloc, id);
    if (!place || place.length < 8 || place.offset + place.length > buf.length) return null;
    const tiff = place.offset + 4 + buf.readUInt32BE(place.offset);
    if (tiff >= place.offset + place.length) return null;
    return Buffer.concat([EXIF_PREFIX, buf.subarray(tiff, place.offset + place.length)]);
  } catch {
    return null;
  }
}
