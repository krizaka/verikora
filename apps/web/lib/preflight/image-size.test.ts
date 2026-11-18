import { describe, expect, it } from "vitest";

import { imageSize, isHeif } from "./image-size";

const png = (w: number, h: number) => {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

/** A JPEG header: SOI, then segments (marker, payload), then a start-of-frame of the given marker. */
const jpeg = (segments: [number, number[]][], sof: number, w: number, h: number, pad = 0) => {
  const out: number[] = [0xff, 0xd8];
  for (const [marker, payload] of segments)
    out.push(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload);
  for (let i = 0; i < pad; i++) out.push(0xff);
  out.push(0xff, sof, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  return Buffer.from(out);
};

describe("imageSize (read from the header, never decoded)", () => {
  it("reads a PNG's IHDR", () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("walks a JPEG's segments to its first start-of-frame", () => {
    expect(
      imageSize(
        jpeg(
          [
            [0xe0, [1, 2, 3, 4]],
            [0xdb, [0, 0, 0]],
          ],
          0xc0,
          1200,
          800,
        ),
      ),
    ).toEqual({ width: 1200, height: 800 });
    expect(imageSize(jpeg([], 0xc2, 3000, 2000))).toEqual({ width: 3000, height: 2000 });
  });

  it("skips fill bytes, and never takes a DHT, JPG or DAC marker for a frame", () => {
    expect(imageSize(jpeg([], 0xc0, 10, 20, 3))).toEqual({ width: 10, height: 20 });
    for (const marker of [0xc4, 0xc8, 0xcc]) expect(imageSize(jpeg([], marker, 10, 20))).toBeNull();
  });

  it("answers null for a broken segment chain, a short file or something else", () => {
    expect(imageSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(imageSize(Buffer.from("hello world, not an image at all"))).toBeNull();
  });
});

describe("isHeif", () => {
  const box = (brand: string) =>
    Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(8)]);
  it("is an ftyp box with a HEIF major brand", () => {
    expect(isHeif(box("heic"))).toBe(true);
    expect(isHeif(box("mif1"))).toBe(true);
    expect(isHeif(box("isom"))).toBe(false);
    expect(isHeif(Buffer.from("short"))).toBe(false);
  });
});

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const isoBox = (type: string, ...payload: Buffer[]) => {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type), body]);
};
/** A HEIC header: ftyp, then meta (a full box) > iprp > ipco > one ispe per size. */
const heic = (...sizes: [number, number][]) => {
  const ispes = sizes.map(([w, h]) => isoBox("ispe", Buffer.alloc(4), u32(w), u32(h)));
  const ipco = isoBox("ipco", ...ispes);
  const meta = isoBox("meta", Buffer.alloc(4), isoBox("iprp", ipco));
  return Buffer.concat([isoBox("ftyp", Buffer.from("heic"), Buffer.alloc(4)), meta]);
};

describe("imageSize: HEIC (ispe box)", () => {
  it("reads the image spatial extent", () => {
    expect(imageSize(heic([4032, 3024]))).toEqual({ width: 4032, height: 3024 });
  });
  it("takes the largest extent when there are several (a thumbnail never hides the image)", () => {
    expect(imageSize(heic([160, 120], [12000, 9000], [320, 240]))).toEqual({ width: 12000, height: 9000 });
  });
  it("answers null when there is no ispe or the boxes are cut", () => {
    expect(
      imageSize(Buffer.concat([isoBox("ftyp", Buffer.from("heic"), Buffer.alloc(4)), isoBox("meta", Buffer.alloc(4))])),
    ).toBeNull();
    expect(imageSize(heic([4032, 3024]).subarray(0, 40))).toBeNull();
  });
});

const riff = (fourcc: string, payload: Buffer) =>
  Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([payload.length + 12, 0, 0, 0]),
    Buffer.from("WEBP"),
    Buffer.from(fourcc),
    Buffer.from([payload.length, 0, 0, 0]),
    payload,
  ]);

describe("imageSize: WebP", () => {
  it("reads a lossy VP8 frame", () => {
    const p = Buffer.alloc(10);
    p.set([0x9d, 0x01, 0x2a], 3);
    p.writeUInt16LE(5000, 6);
    p.writeUInt16LE(4000, 8);
    expect(imageSize(riff("VP8 ", p))).toEqual({ width: 5000, height: 4000 });
  });
  it("reads a lossless VP8L frame", () => {
    const p = Buffer.alloc(5);
    p[0] = 0x2f;
    p.writeUInt32LE(((3000 - 1) | ((2000 - 1) << 14)) >>> 0, 1);
    expect(imageSize(riff("VP8L", p))).toEqual({ width: 3000, height: 2000 });
  });
  it("reads an extended VP8X canvas", () => {
    const p = Buffer.alloc(10);
    p.writeUIntLE(8000 - 1, 4, 3);
    p.writeUIntLE(6000 - 1, 7, 3);
    expect(imageSize(riff("VP8X", p))).toEqual({ width: 8000, height: 6000 });
  });
  it("answers null for a cut or unknown chunk", () => {
    expect(imageSize(riff("VP8 ", Buffer.alloc(4)))).toBeNull();
    expect(imageSize(riff("JUNK", Buffer.alloc(12)))).toBeNull();
  });
});
