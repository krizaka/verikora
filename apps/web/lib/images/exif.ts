import exifReader from "exif-reader";
import sharp from "sharp";

import { heicExif } from "./heic-exif";
import { PHOTO_KIND, type PhotoFacts, type PhotoInput } from "./port";

const NONE: PhotoFacts = { software: null, device: null, takenAt: null, modifiedAt: null, hadGps: false };
const iso = (value: unknown) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.replaceAll("\0", "").trim().slice(0, 80) : null;

/**
 * What the photo's own metadata says about its origin, read BEFORE the metadata is dropped: the software that last saved it,
 * the device (make and model, as a label), when it was taken and last modified, and whether it carried a GPS position (never the
 * position). A HEIC's EXIF item is read from its boxes (no decoding); when there is none every fact is null. Never a verdict.
 */
export async function readFacts(input: PhotoInput): Promise<PhotoFacts> {
  try {
    const exif =
      input.kind === PHOTO_KIND.heic ? heicExif(input.bytes) : (await sharp(Buffer.from(input.bytes)).metadata()).exif;
    if (!exif) return NONE;
    const tags = exifReader(exif);
    const [make, model] = [text(tags.Image?.Make), text(tags.Image?.Model)];
    return {
      software: text(tags.Image?.Software),
      device:
        [make, model && make && model.startsWith(make) ? model.slice(make.length).trim() : model]
          .filter(Boolean)
          .join(" ") || null,
      takenAt: iso(tags.Photo?.DateTimeOriginal),
      modifiedAt: iso(tags.Image?.ModifyDate),
      hadGps: !!tags.GPSInfo && Object.keys(tags.GPSInfo).length > 0,
    };
  } catch {
    return NONE;
  }
}
