import { MAX_FILE_BYTES } from "@verikora/core";

import { refuse } from "./http";
import { VERIKORA_IMAGE_RULES } from "./images/rules";

/** The multipart framing (boundaries, field names, small fields) a request may carry on top of its files. */
// @fixed: the envelope of a multipart form, not a limit an administrator tunes
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** The most photos one upload may carry (the pre-flight's rule), counted before any is read. */
export const MAX_PHOTOS_PER_UPLOAD = VERIKORA_IMAGE_RULES.maxPhotos;

/** The largest a request can ever be, whatever an administrator sets: the platform's file cap for every photo, plus the framing. */
export const HARD_MAX_REQUEST_BYTES = MAX_FILE_BYTES * MAX_PHOTOS_PER_UPLOAD + FORM_OVERHEAD_BYTES;

/** The request ceiling from the administrator's file limit, never above the fixed hard maximum. */
export function requestCeiling(maxFileBytes: number): number {
  return Math.min(HARD_MAX_REQUEST_BYTES, maxFileBytes * MAX_PHOTOS_PER_UPLOAD + FORM_OVERHEAD_BYTES);
}

const tooLarge = () => refuse(413, "FILE_TOO_LARGE", "Too large");

/** Refuses an announced size over the ceiling before a byte is read. A missing or invalid header is left to the byte count. */
export function assertAnnouncedSize(req: Request, ceiling: number): void {
  const announced = Number(req.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > ceiling) {
    throw tooLarge();
  }
}

/** Reads the body counting bytes as they arrive and cuts the read at the ceiling, whatever `content-length` said. */
export async function readBoundedBody(req: Request, ceiling: number): Promise<Uint8Array<ArrayBuffer>> {
  assertAnnouncedSize(req, ceiling);
  if (!req.body) {
    return new Uint8Array(new ArrayBuffer(0));
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > ceiling) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The multipart form of a request, parsed only once its bytes are within the ceiling; null when it is not a form. */
export async function readBoundedForm(req: Request, ceiling: number): Promise<FormData | null> {
  const body = await readBoundedBody(req, ceiling);
  const contentType = req.headers.get("content-type");
  if (!contentType) {
    return null;
  }
  return new Response(body, { headers: { "content-type": contentType } }).formData().catch(() => null);
}

/** The photo count, checked on the file parts before any of them is read. */
export function assertPhotoCount(count: number): void {
  if (count > MAX_PHOTOS_PER_UPLOAD) {
    throw refuse(422, "TOO_MANY_PHOTOS", `At most ${MAX_PHOTOS_PER_UPLOAD} photos make one document`);
  }
}
