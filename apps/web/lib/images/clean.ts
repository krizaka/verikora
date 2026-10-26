import sharp, { type Sharp } from "sharp";

import { estimateSkew, type Gray, pageBox } from "./deskew";
import { readFacts } from "./exif";
import { type ImageCleaner, ImageError, type ImageRules, PHOTO_KIND, type PhotoInput } from "./port";
import { assessQuality } from "./quality";

/** HEIC is decoded in WebAssembly (the prebuilt image library has no HEIC codec: its patents). The decoder applies the camera's rotation itself. */
export async function decodeHeic(bytes: Uint8Array): Promise<Sharp> {
  const { default: decode } = await import("heic-decode");
  const image = await decode({ buffer: Buffer.from(bytes) });
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), { raw: { width: image.width, height: image.height, channels: 4 } });
}

async function grayOf(image: Sharp, width: number): Promise<Gray> {
  const { data, info } = await image.clone().resize({ width, withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

/**
 * Cleans one photo: the camera's orientation applied, the page turned level, cropped to the page, in grey with its contrast
 * stretched, and every piece of metadata dropped (sharp keeps none unless asked). Deterministic: the same photo gives the same page.
 */
export function createImageCleaner(rules: ImageRules): ImageCleaner {
  return {
    async clean(input: PhotoInput) {
      try {
        const facts = await readFacts(input);
        // 1. orientation (EXIF) and size, flattened on white, as pixels.
        const base = input.kind === PHOTO_KIND.heic ? await decodeHeic(input.bytes) : sharp(Buffer.from(input.bytes), { failOn: "error", limitInputPixels: 80_000_000 });
        const oriented = await base
          .rotate()
          .flatten({ background: "#ffffff" })
          .resize({ width: rules.maxSide, height: rules.maxSide, fit: "inside", withoutEnlargement: true })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let image = sharp(oriented.data, { raw: { width: oriented.info.width, height: oriented.info.height, channels: oriented.info.channels } });

        // 2. skew: measured on a small copy, corrected on the real one (the empty corners it opens are black, which the crop then removes).
        const angle = estimateSkew(await grayOf(image, 600), { max: rules.deskewMaxDegrees, step: rules.deskewStepDegrees });
        let skewDegrees = 0;
        if (Math.abs(angle) >= rules.deskewStepDegrees) {
          const turned = await image.rotate(angle, { background: "#000000" }).raw().toBuffer({ resolveWithObject: true });
          image = sharp(turned.data, { raw: { width: turned.info.width, height: turned.info.height, channels: turned.info.channels } });
          skewDegrees = angle;
        }

        // 3. crop to the page, when there is a page distinct from its surroundings.
        const small = await grayOf(image, 400);
        const box = pageBox(small, rules.minPageShare);
        let cropped = false;
        if (box) {
          const meta = await image.metadata();
          const [fx, fy] = [meta.width! / small.width, meta.height! / small.height];
          const region = { left: Math.floor(box.left * fx), top: Math.floor(box.top * fy), width: Math.min(meta.width!, Math.ceil((box.right - box.left + 1) * fx)), height: Math.min(meta.height!, Math.ceil((box.bottom - box.top + 1) * fy)) };
          const cut = await image.extract(region).raw().toBuffer({ resolveWithObject: true });
          image = sharp(cut.data, { raw: { width: cut.info.width, height: cut.info.height, channels: cut.info.channels } });
          cropped = true;
        }

        // 4. how readable it is, on the cropped page before the contrast is stretched (a glare is still a glare).
        const quality = assessQuality(await grayOf(image, 1000), rules.quality, !cropped);

        const out = await image.grayscale().normalise().jpeg({ quality: rules.jpegQuality, mozjpeg: false }).toBuffer({ resolveWithObject: true });
        return { page: { jpeg: new Uint8Array(out.data), width: out.info.width, height: out.info.height, steps: { orientation: input.kind !== PHOTO_KIND.heic, skewDegrees, cropped }, quality }, facts };
      } catch (error) {
        if (error instanceof ImageError) throw error;
        throw new ImageError("UNREADABLE_IMAGE");
      }
    },
  };
}
