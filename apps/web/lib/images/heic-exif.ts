/**
 * The EXIF block of a HEIC file, found without decoding the image: HEIC is an ISO box file, its metadata an item typed `Exif`
 * listed in `iinf` and located by `iloc`. Returns the block as sharp gives it for a JPEG (`Exif\0\0` then the TIFF data), or
 * null when there is none or the file is not shaped as expected. Never throws: a photo with unreadable boxes has no facts.
 */
const EXIF_PREFIX = Buffer.from("Exif\0\0", "latin1");

type Box = { type: string; end: number; body: number };
type Extent = { offset: number; length: number };

/** A cursor over the bytes: each read moves it on. */
class Reader {
  at: number;
  constructor(
    readonly buf: Buffer,
    at: number,
  ) {
    this.at = at;
  }
  uint(size: number): number {
    if (size === 0) {
      return 0;
    }
    const value = this.buf.readUIntBE(this.at, Math.min(size, 6));
    this.at += size;
    return value;
  }
  text(size: number): string {
    const value = this.buf.toString("latin1", this.at, this.at + size);
    this.at += size;
    return value;
  }
}

function boxes(buf: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const declared = buf.readUInt32BE(at);
    const size = declared === 0 ? to - at : declared;
    if (size < 8 || at + size > to) {
      break;
    }
    out.push({ type: buf.toString("latin1", at + 4, at + 8), end: at + size, body: at + 8 });
    at += size;
  }
  return out;
}

/** The id of the item whose type is `Exif`, from the `iinf` box. */
function exifItemId(buf: Buffer, iinf: Box): number | null {
  const head = new Reader(buf, iinf.body);
  const version = head.uint(1);
  head.uint(3);
  head.uint(version === 0 ? 2 : 4);
  for (const infe of boxes(buf, head.at, iinf.end)) {
    const r = new Reader(buf, infe.body);
    const infeVersion = r.uint(1);
    r.uint(3);
    if (infe.type !== "infe" || infeVersion < 2) {
      continue;
    }
    const id = r.uint(infeVersion >= 3 ? 4 : 2);
    r.uint(2); // protection index
    if (r.text(4) === "Exif") {
      return id;
    }
  }
  return null;
}

/** The first extent of an item stored in the file itself, from the `iloc` box. */
function locate(buf: Buffer, iloc: Box, wanted: number): Extent | null {
  const r = new Reader(buf, iloc.body);
  const version = r.uint(1);
  r.uint(3);
  const sizes = r.uint(2);
  const [offsetSize, lengthSize, baseSize] = [sizes >> 12, (sizes >> 8) & 15, (sizes >> 4) & 15];
  const indexSize = version > 0 ? sizes & 15 : 0;
  const idSize = version < 2 ? 2 : 4;
  const count = r.uint(idSize);
  for (let i = 0; i < count; i++) {
    const id = r.uint(idSize);
    const method = version > 0 ? r.uint(2) & 15 : 0;
    r.uint(2); // data reference index
    const base = r.uint(baseSize);
    const extents = r.uint(2);
    const found: Extent[] = [];
    for (let e = 0; e < extents; e++) {
      r.uint(indexSize);
      const offset = r.uint(offsetSize);
      found.push({ offset: base + offset, length: r.uint(lengthSize) });
    }
    if (id === wanted) {
      return method === 0 ? (found[0] ?? null) : null;
    }
  }
  return null;
}

function exifExtent(buf: Buffer): Extent | null {
  const meta = boxes(buf, 0, buf.length).find((b) => b.type === "meta");
  if (!meta) {
    return null;
  }
  const inner = boxes(buf, meta.body + 4, meta.end);
  const iinf = inner.find((b) => b.type === "iinf");
  const iloc = inner.find((b) => b.type === "iloc");
  const id = iinf ? exifItemId(buf, iinf) : null;
  return iloc && id !== null ? locate(buf, iloc, id) : null;
}

export function heicExif(bytes: Uint8Array): Buffer | null {
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const place = exifExtent(buf);
    if (!place || place.length < 8 || place.offset + place.length > buf.length) {
      return null;
    }
    const end = place.offset + place.length;
    const tiff = place.offset + 4 + buf.readUInt32BE(place.offset);
    return tiff < end ? Buffer.concat([EXIF_PREFIX, buf.subarray(tiff, end)]) : null;
  } catch {
    return null;
  }
}
