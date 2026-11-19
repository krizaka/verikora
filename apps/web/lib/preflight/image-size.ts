type Size = { width: number; height: number };

/** A start-of-frame marker: SOF0–SOF15, but not DHT (0xc4), JPG (0xc8) or DAC (0xcc). */
const isFrameMarker = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/** JPEG: walk the marker segments to the first start-of-frame. */
function jpegSize(bytes: Uint8Array, view: DataView): Size | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      return null;
    }
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (isFrameMarker(marker)) {
      return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + view.getUint16(i + 2);
  }
  return null;
}

const MAX_BOX_DEPTH = 4;
const ISO_CONTAINERS = new Set(["meta", "iprp", "ipco"]);
const fourcc = (bytes: Uint8Array, at: number) => Buffer.from(bytes.subarray(at, at + 4)).toString("latin1");
const area = (s: Size) => s.width * s.height;

/** The size one box declares: an ispe itself, or the largest inside a container box. */
function boxSize(
  bytes: Uint8Array,
  view: DataView,
  type: string,
  at: number,
  stop: number,
  depth: number,
): Size | null {
  if (type === "ispe") {
    return at + 20 <= stop ? { width: view.getUint32(at + 12), height: view.getUint32(at + 16) } : null;
  }
  if (!ISO_CONTAINERS.has(type) || depth >= MAX_BOX_DEPTH) {
    return null;
  }
  return heifSize(bytes, view, at + (type === "meta" ? 12 : 8), stop, depth + 1);
}

/** HEIC/HEIF: walk meta > iprp > ipco for every ispe (image spatial extent) and keep the largest, so a thumbnail never hides the image. */
function heifSize(bytes: Uint8Array, view: DataView, start = 0, end = bytes.length, depth = 0): Size | null {
  let best: Size | null = null;
  let i = start;
  while (i + 8 <= end) {
    const length = view.getUint32(i);
    if (length !== 0 && length < 8) {
      return best;
    }
    const stop = length === 0 ? end : Math.min(i + length, end);
    const found = boxSize(bytes, view, fourcc(bytes, i + 4), i, stop, depth);
    if (found && (!best || area(found) > area(best))) {
      best = found;
    }
    i = stop;
  }
  return best;
}

/** WebP: a RIFF container whose first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended canvas). */
function webpSize(bytes: Uint8Array, view: DataView): Size | null {
  if (bytes.length < 25) {
    return null;
  }
  const chunk = fourcc(bytes, 12);
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    const le24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    return { width: le24(24) + 1, height: le24(27) + 1 };
  }
  return null;
}

/** The pixel size an image's header declares — read from the bytes, never decoded (a decompression bomb is refused before any decoder runs). */
export function imageSize(bytes: Uint8Array): Size | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG: the IHDR chunk follows the 8-byte signature and its 8-byte chunk header.
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return jpegSize(bytes, view);
  }
  if (isHeif(bytes)) {
    return heifSize(bytes, view);
  }
  if (isWebp(bytes)) {
    return webpSize(bytes, view);
  }
  return null;
}

/** HEIC and HEIF are ISO base media files: an « ftyp » box whose major brand is one of these. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
export function isHeif(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp" &&
    HEIF_BRANDS.has(Buffer.from(bytes.subarray(8, 12)).toString("latin1"))
  );
}

/** WebP is a RIFF container whose form type is « WEBP » (`RIFF`, 4 size bytes, `WEBP`). */
export const isWebp = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 && fourcc(bytes, 0) === "RIFF" && fourcc(bytes, 8) === "WEBP";
