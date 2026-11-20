import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createImageCleaner } from "./clean";
import { readFacts } from "./exif";
import { photoOfPage } from "./fixtures";
import { heicExif } from "./heic-exif";
import { PHOTO_KIND } from "./port";
import { VERIKORA_IMAGE_RULES } from "./rules";

const u32 = (n: number) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n: number) => Buffer.from([n >> 8, n & 255]);
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, "latin1"), body]);
};

/** A HEIC-shaped box file (ftyp, meta with iinf and iloc, mdat) whose Exif item holds `exif` (sharp's `Exif\0\0` + TIFF). */
function heicWith(exif: Buffer): Uint8Array {
  const item = Buffer.concat([u32(0), exif.subarray(6)]); // exif_tiff_header_offset = 0, then the TIFF data
  const infe = (id: number, type: string) => box("infe", Buffer.from([2, 0, 0, 0]), u16(id), u16(0), Buffer.from(type, "latin1"), Buffer.from([0]));
  const iinf = box("iinf", Buffer.from([0, 0, 0, 0]), u16(2), infe(1, "hvc1"), infe(2, "Exif"));
  const ilocOf = (offset: number) =>
    box("iloc", Buffer.from([0, 0, 0, 0]), Buffer.from([0x44, 0x00]), u16(1), u16(2), u16(0), u16(1), u32(offset), u32(item.length));
  const ftyp = box("ftyp", Buffer.from("heic", "latin1"), u32(0), Buffer.from("mif1", "latin1"));
  const metaOf = (offset: number) => box("meta", Buffer.from([0, 0, 0, 0]), iinf, ilocOf(offset));
  const offset = ftyp.length + metaOf(0).length + 8; // the mdat payload
  return new Uint8Array(Buffer.concat([ftyp, metaOf(offset), box("mdat", item)]));
}

describe("the origin facts of a HEIC", () => {
  it("are read from its Exif item: device, editor and the presence of a GPS position", async () => {
    const jpeg = await photoOfPage({ editor: "Photos 9.0" });
    const exif = (await sharp(jpeg).metadata()).exif!;
    const facts = await readFacts({ bytes: heicWith(exif), kind: PHOTO_KIND.heic });
    expect(facts).toMatchObject({ device: "Apple iPhone 15", software: "Photos 9.0", hadGps: true });
  });

  it("are empty, never an error, for a HEIC without an Exif item or with broken boxes", async () => {
    expect(heicExif(new Uint8Array(40))).toBeNull();
    expect(heicExif(new Uint8Array(0))).toBeNull();
    const none = await readFacts({ bytes: new Uint8Array([0, 0, 0, 12, 0x6d, 0x65, 0x74, 0x61, 0, 0, 0, 0]), kind: PHOTO_KIND.heic });
    expect(none).toMatchObject({ device: null, hadGps: false });
  });

  it("leave no metadata block in the cleaned page, for a JPEG and a PNG with GPS, device and editor", async () => {
    const cleaner = createImageCleaner(VERIKORA_IMAGE_RULES);
    for (const format of ["jpeg", "png"] as const) {
      const input = await photoOfPage({ editor: "Photos 9.0", format });
      const { page, facts } = await cleaner.clean({ bytes: input, kind: format === "png" ? PHOTO_KIND.png : PHOTO_KIND.jpeg });
      expect(facts.hadGps).toBe(true);
      const meta = await sharp(page.jpeg).metadata();
      expect([meta.exif, meta.xmp, meta.iptc, meta.icc, meta.tifftagPhotoshop]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      expect(Buffer.from(page.jpeg).includes(Buffer.from("Apple"))).toBe(false);
    }
  });
});
