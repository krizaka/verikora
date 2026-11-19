import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PhotoQuality } from "./images";
import { type CleanedPage, ImageError, type ImageRules, type PhotoFacts, VERIKORA_IMAGE_RULES } from "./images";
import type { OcrEngine, OcrResult } from "./ocr";
import { VERIKORA_OCR_RULES } from "./ocr";
import { memoryStore } from "./storage/memory";

const stored = vi.hoisted(() => ({
  calls: [] as {
    file: { name: string; type: string; size: number };
    bytes: Uint8Array;
    requested: string;
    policy: { rules?: { allowedKinds: readonly string[] } } | undefined;
    textOf: (() => Promise<{ text: string; source: unknown; file?: Uint8Array }>) | undefined;
    defer: boolean | undefined;
  }[],
}));

vi.mock("./documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./documents")>();
  return {
    ...actual,
    storeDocument: async (
      _owner: string,
      file: { name: string; type: string; size: number },
      bytes: Uint8Array,
      requested: string,
      policy: { rules?: { allowedKinds: readonly string[] } } | undefined,
      textOf: (() => Promise<{ text: string; source: unknown; file?: Uint8Array }>) | undefined,
      options?: { defer?: boolean },
    ) => {
      stored.calls.push({ file, bytes, requested, policy, textOf, defer: options?.defer });
      return { summary: { id: "doc-1" }, duplicate: false };
    },
  };
});

import { isPhoto, PHOTO_QUALITY_CODE, type PhotoDeps, type PhotoFile, storePhotos } from "./photos";

const png = async (): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "#ffffff" } })
      .png()
      .toBuffer(),
  );

const jpeg = async (): Promise<Uint8Array> =>
  new Uint8Array(
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cccccc" } })
      .jpeg()
      .toBuffer(),
  );

const GOOD: PhotoQuality = { sharpness: 500, glareShare: 0, edgeInk: 0 };
const NO_FACTS: PhotoFacts = { software: null, device: null, takenAt: null, modifiedAt: null, hadGps: false };

const pageOf = async (quality: PhotoQuality = GOOD): Promise<CleanedPage> => ({
  jpeg: await jpeg(),
  width: 40,
  height: 30,
  steps: { orientation: false, skewDegrees: 0, cropped: false },
  quality,
});

const reading = (over: Partial<OcrResult> = {}): OcrResult => ({
  text: "Bail de logement, loyer mensuel de mille cent cinquante dollars payable le premier du mois",
  confidence: 90,
  pages: [{ text: "x", confidence: 90 }],
  ...over,
});

const depsWith = (
  clean: PhotoDeps["cleaner"]["clean"],
  ocr: Partial<OcrEngine> & { result?: OcrResult } = {},
  rules: ImageRules = VERIKORA_IMAGE_RULES,
): PhotoDeps => ({
  cleaner: { clean },
  ocr: { name: "fake-ocr", read: async () => ocr.result ?? reading() },
  vision: null,
  ocrRules: VERIKORA_OCR_RULES,
  imageRules: rules,
});

const photo = async (name = "bail.png"): Promise<PhotoFile> => ({ name, type: "image/png", bytes: await png() });

const refusal = async (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (error: { status: number; body: { code?: string; photo?: number } }) => error,
  );

beforeEach(() => {
  stored.calls.length = 0;
});

describe("what counts as a photo", () => {
  it("is decided by the signature of the bytes, not the name", async () => {
    expect(isPhoto(await png())).toBe(true);
    expect(isPhoto(await jpeg())).toBe(true);
    expect(isPhoto(new TextEncoder().encode("%PDF-1.7 not a photo.png"))).toBe(false);
    expect(isPhoto(new Uint8Array())).toBe(false);
  });

  it("maps each quality problem to the code the page translates", () => {
    expect(PHOTO_QUALITY_CODE).toEqual({ BLURRY: "PHOTO_BLURRY", GLARE: "PHOTO_GLARE", CUT_OFF: "PHOTO_CUT_OFF" });
  });
});

describe("a large phone photo never ends in a silent proxy timeout (krizaka-internal#4056)", () => {
  it("is refused with its reason when the cleaning outlasts the request's budget", async () => {
    const slow: PhotoDeps["cleaner"]["clean"] = () => new Promise(() => undefined);
    const rules = { ...VERIKORA_IMAGE_RULES, cleanBudgetMs: 50 };
    const file = await photo();
    const started = Date.now();
    const error = await refusal(() => storePhotos("owner", [file], "auto", { deps: depsWith(slow, {}, rules) }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("PHOTO_TOO_SLOW");
    expect(stored.calls).toHaveLength(0);
  });

  it("hands the slow text reading to the deferred path, so the answer does not wait for it", async () => {
    const clean: PhotoDeps["cleaner"]["clean"] = async () => ({ page: await pageOf(), facts: NO_FACTS });
    await storePhotos("owner", [await photo()], "auto", { deps: depsWith(clean), defer: true });
    expect(stored.calls[0]?.defer).toBe(true);
  });
});

describe("storing photos is refused before anything is stored", () => {
  it("wants at least one photo", async () => {
    const error = await refusal(async () =>
      storePhotos("o", [], "auto", { deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS })) }),
    );
    expect(error?.status).toBe(400);
    expect(error?.body.code).toBe("BAD_REQUEST");
  });

  it("refuses more photos than one document takes", async () => {
    const rules = { ...VERIKORA_IMAGE_RULES, maxPhotos: 1 };
    const one = await photo();
    const error = await refusal(async () =>
      storePhotos("o", [one, one], "auto", {
        deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS }), {}, rules),
      }),
    );
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("TOO_MANY_PHOTOS");
    expect(stored.calls).toHaveLength(0);
  });

  it("refuses a file that is not a photo, whatever its name says", async () => {
    const pdf: PhotoFile = {
      name: "scan.pdf",
      type: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
    };
    const error = await refusal(async () =>
      storePhotos("o", [pdf], "auto", { deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS })) }),
    );
    expect(error).not.toBeNull();
    expect(stored.calls).toHaveLength(0);
  });

  it("says 422 with the cleaner's code when a photo cannot be read", async () => {
    const error = await refusal(async () =>
      storePhotos("o", [await photo()], "auto", {
        deps: depsWith(async () => {
          throw new ImageError("UNREADABLE_IMAGE");
        }),
      }),
    );
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("UNREADABLE_IMAGE");
  });

  it("lets an unexpected cleaner failure through untouched", async () => {
    const boom = new Error("disk gone");
    await expect(
      storePhotos("o", [await photo()], "auto", {
        deps: depsWith(async () => {
          throw boom;
        }),
      }),
    ).rejects.toBe(boom);
  });

  it.each([
    ["BLURRY", { sharpness: 1, glareShare: 0, edgeInk: 0 }],
    ["GLARE", { sharpness: 500, glareShare: 0.5, edgeInk: 0 }],
    ["CUT_OFF", { sharpness: 500, glareShare: 0, edgeInk: 0.5 }],
  ] as const)("names the photo that is %s", async (problem, quality) => {
    const good = await photo("a.png");
    const bad = await photo("b.png");
    let n = 0;
    const error = await refusal(async () =>
      storePhotos("o", [good, bad], "auto", {
        deps: depsWith(async () => ({ page: await pageOf(++n === 2 ? quality : GOOD), facts: NO_FACTS })),
      }),
    );
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe(PHOTO_QUALITY_CODE[problem]);
    expect(error?.body.photo).toBe(2);
    expect(stored.calls).toHaveLength(0);
  });
});

describe("storing photos makes one PDF", () => {
  it("hands the store a PDF named after the first photo, with the requested kind", async () => {
    const result = await storePhotos("o", [await photo("Bail 2026.jpeg.png"), await photo("p2.png")], "lease", {
      deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS })),
    });
    expect(result).toEqual({ summary: { id: "doc-1" }, duplicate: false });
    const [call] = stored.calls;
    expect(call?.file.name).toBe("Bail 2026.jpeg.pdf");
    expect(call?.file.type).toBe("application/pdf");
    expect(call?.file.size).toBe(call?.bytes.length);
    expect(Buffer.from(call!.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(call?.requested).toBe("lease");
    expect(call?.policy).toBeUndefined();
  });

  it("falls back to « photo » when the name is only an extension", async () => {
    await storePhotos("o", [await photo(".png")], "auto", {
      deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS })),
    });
    expect(stored.calls[0]?.file.name).toBe("photo.pdf");
  });

  it("lets the policy's rules accept the PDF it made, even when the workspace allows photos only", async () => {
    const policy = {
      keep: true,
      store: memoryStore(),
      now: new Date(),
      purgeAfterHours: 1,
      tenant: "t",
      rules: { ...(await import("./preflight/rules")).VERIKORA_RULES, allowedKinds: ["png" as const] },
    };
    await storePhotos("o", [await photo()], "auto", {
      policy,
      deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS })),
    });
    expect(stored.calls[0]?.policy?.rules?.allowedKinds).toEqual(["png", "pdf"]);
  });

  it("reads the text locally and says where the photos came from", async () => {
    const facts: PhotoFacts[] = [
      { ...NO_FACTS, device: "Apple iPhone 15" },
      { ...NO_FACTS, hadGps: true, takenAt: "2026-01-02T03:04:05" },
    ];
    let n = 0;
    await storePhotos("o", [await photo("a.png"), await photo("b.png")], "auto", {
      deps: depsWith(async () => ({ page: await pageOf(), facts: facts[n++]! })),
    });
    const read = await stored.calls[0]!.textOf!();
    expect(read.text).toContain("Bail de logement");
    expect(read.file).toBeUndefined();
    expect(read.source).toMatchObject({
      kind: "ocr",
      engine: "fake-ocr",
      photos: 2,
      lowConfidence: false,
      origin: {
        software: null,
        device: "Apple iPhone 15",
        takenAt: "2026-01-02T03:04:05",
        modifiedAt: null,
        hadGps: true,
      },
    });
  });

  it("has no origin when no photo says anything about where it came from", async () => {
    await storePhotos("o", [await photo()], "auto", {
      deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS })),
    });
    const read = await stored.calls[0]!.textOf!();
    expect(read.source).toMatchObject({ origin: null });
  });

  it("keeps a PDF carrying the recognised words when the engine found their boxes", async () => {
    const words = [{ text: "Bail", bbox: { x0: 1, y0: 1, x1: 20, y1: 10 } }];
    await storePhotos("o", [await photo()], "auto", {
      deps: depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS }), {
        result: reading({ pages: [{ text: "Bail", confidence: 90, words }] }),
      }),
    });
    const read = await stored.calls[0]!.textOf!();
    expect(read.file).toBeDefined();
    expect(Buffer.from(read.file!.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(read.file).not.toEqual(stored.calls[0]!.bytes);
  });

  it("answers OCR_FAILED when the reading throws, without leaking the cause", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deps = depsWith(async () => ({ page: await pageOf(), facts: NO_FACTS }));
    deps.ocr = {
      name: "broken",
      read: async () => {
        throw new Error("tesseract crashed");
      },
    };
    await storePhotos("o", [await photo()], "auto", { deps });
    const error = await refusal(async () => stored.calls[0]!.textOf!());
    quiet.mockRestore();
    expect(error?.status).toBe(422);
    expect(error?.body.code).toBe("OCR_FAILED");
  });
});
