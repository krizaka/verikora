import { MAX_FILE_BYTES } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { HttpError } from "./http";
import {
  assertPhotoCount,
  HARD_MAX_REQUEST_BYTES,
  MAX_PHOTOS_PER_UPLOAD,
  readBoundedBody,
  readBoundedForm,
  requestCeiling,
} from "./upload-bounds";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://x/api/documents", { method: "POST", body, headers });

/** A request whose body streams `chunks` of `size` bytes with no content-length (a chunked upload). */
const streamed = (chunks: number, size: number, pulled: { n: number }) =>
  new Request("http://x/api/documents", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      pull(controller) {
        pulled.n += 1;
        if (pulled.n > chunks) {
          controller.close();
        } else {
          controller.enqueue(new Uint8Array(size));
        }
      },
    }),
  } as RequestInit);

const refusal = async (run: () => Promise<unknown> | void) => {
  try {
    await run();
  } catch (error) {
    return error as HttpError;
  }
  return null;
};

describe("the request ceiling", () => {
  it("follows the administrator's file limit", () => {
    expect(requestCeiling(1024 * 1024)).toBeLessThan(requestCeiling(MAX_FILE_BYTES));
  });
  it("never goes above the fixed hard maximum, whatever the limit says", () => {
    expect(requestCeiling(MAX_FILE_BYTES * 1000)).toBe(HARD_MAX_REQUEST_BYTES);
    expect(HARD_MAX_REQUEST_BYTES).toBeLessThan(200 * 1024 * 1024);
  });
});

describe("a body read within the ceiling", () => {
  it("refuses an announced size over the ceiling with 413 FILE_TOO_LARGE before reading", async () => {
    const announced = post(new Uint8Array(10), { "content-length": "5000" });
    const error = await refusal(() => readBoundedBody(announced, 1000));
    expect(error?.status).toBe(413);
    expect(error?.body.code).toBe("FILE_TOO_LARGE");
  });
  it("cuts a body with no content-length at the ceiling, without reading it to the end", async () => {
    const pulled = { n: 0 };
    const error = await refusal(() => readBoundedBody(streamed(10_000, 1024, pulled), 4096));
    expect(error?.status).toBe(413);
    expect(pulled.n).toBeLessThan(20);
  });
  it("cuts a body that lies about its content-length", async () => {
    const req = post(new Uint8Array(5000), { "content-length": "10" });
    const error = await refusal(() => readBoundedBody(req, 1000));
    expect(error?.body.code).toBe("FILE_TOO_LARGE");
  });
  it("reads a body within the ceiling whole", async () => {
    const body = await readBoundedBody(post(new Uint8Array(500)), 1000);
    expect(body.byteLength).toBe(500);
  });
  it("parses the multipart form of a body within the ceiling", async () => {
    const form = new FormData();
    form.set("file", new File(["hello"], "a.txt", { type: "text/plain" }));
    const asked = post(form);
    const parsed = await readBoundedForm(asked, 100_000);
    expect(parsed?.getAll("file")).toHaveLength(1);
  });
  it("answers null for a body that is not a form", async () => {
    expect(await readBoundedForm(post("nope", { "content-type": "text/plain" }), 1000)).toBeNull();
  });
});

describe("the photo count", () => {
  it("accepts up to the maximum and refuses one more with 422 TOO_MANY_PHOTOS", async () => {
    expect(await refusal(() => assertPhotoCount(MAX_PHOTOS_PER_UPLOAD))).toBeNull();
    const error = await refusal(() => assertPhotoCount(MAX_PHOTOS_PER_UPLOAD + 1));
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("TOO_MANY_PHOTOS");
  });
});
