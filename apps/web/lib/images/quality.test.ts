import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";

import { createImageCleaner } from "./clean";
import { pageSvg, photoOfPage } from "./fixtures";
import { assessQuality, laplacianVariance, qualityProblem } from "./quality";
import { YOMIZAKA_IMAGE_RULES } from "./rules";

const cleaner = createImageCleaner(YOMIZAKA_IMAGE_RULES);
const rules = YOMIZAKA_IMAGE_RULES.quality;
const jpeg = async (pipeline: Sharp) => new Uint8Array(await pipeline.jpeg().toBuffer());
const problemOf = async (bytes: Uint8Array) => qualityProblem((await cleaner.clean({ bytes, kind: "jpeg" })).page.quality, rules);

/** The fictional lease page, lit evenly or with a flash washing part of it out, photographed or scanned flat. */
async function fixtures() {
  const flat = await photoOfPage();
  const { width, height } = await sharp(flat).metadata();
  const flash = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><ellipse cx="${width! / 2}" cy="${height! / 2}" rx="${width! * 0.3}" ry="${height! * 0.3}" fill="white"/></svg>`,
  );
  const dimmed = await sharp(flat).linear(0.8, 0).png().toBuffer();
  const scan = await sharp(pageSvg()).png().toBuffer();
  return {
    flat,
    tilted: await photoOfPage({ degrees: 6 }),
    blurred: await jpeg(sharp(flat).blur(6)),
    glared: await jpeg(sharp(dimmed).composite([{ input: flash }])),
    scan: await jpeg(sharp(scan)),
    cutAtTheLeft: await jpeg(sharp(scan).extract({ left: 20, top: 0, width: 700, height: 520 })),
    cutAtTheRight: await jpeg(sharp(scan).extract({ left: 0, top: 0, width: 700, height: 520 })),
  };
}

describe("can this photo be read? (yomizaka#8)", () => {
  it("lets a sharp photo through, tilted or not, and a flat scan", async () => {
    const f = await fixtures();
    expect(await problemOf(f.flat)).toBeNull();
    expect(await problemOf(f.tilted)).toBeNull();
    expect(await problemOf(f.scan)).toBeNull();
  });

  it("refuses a blurred page: its text has no edges", async () => {
    expect(await problemOf((await fixtures()).blurred)).toBe("BLURRY");
  });

  it("refuses a page a flash washed out, but never a page that is simply white", async () => {
    const f = await fixtures();
    expect(await problemOf(f.glared)).toBe("GLARE");
    expect((await cleaner.clean({ bytes: f.scan, kind: "jpeg" })).page.quality.glareShare).toBe(0);
  });

  it("refuses a page the frame cuts off, at either side", async () => {
    const f = await fixtures();
    expect(await problemOf(f.cutAtTheLeft)).toBe("CUT_OFF");
    expect(await problemOf(f.cutAtTheRight)).toBe("CUT_OFF");
  });

  it("says a blur first: nothing else matters when the text has no edges", () => {
    expect(qualityProblem({ sharpness: 1, glareShare: 0.5, edgeInk: 0.5 }, rules)).toBe("BLURRY");
    expect(qualityProblem({ sharpness: 900, glareShare: 0.5, edgeInk: 0.5 }, rules)).toBe("GLARE");
    expect(qualityProblem({ sharpness: 900, glareShare: 0, edgeInk: 0.5 }, rules)).toBe("CUT_OFF");
  });
});

describe("the measures", () => {
  it("a flat bitmap has no sharpness; edges have", () => {
    const flat = { data: new Uint8Array(100).fill(200), width: 10, height: 10 };
    expect(laplacianVariance(flat)).toBe(0);
    expect(laplacianVariance({ ...flat, data: Uint8Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0 : 255)) })).toBeGreaterThan(1000);
    expect(laplacianVariance({ data: new Uint8Array(4), width: 2, height: 2 })).toBe(0);
  });

  it("ink on an edge counts only when the page fills the frame", () => {
    const page = { data: new Uint8Array(100 * 100).fill(255), width: 100, height: 100 };
    for (let y = 0; y < 100; y++) page.data[y * 100] = 0;
    expect(assessQuality(page, { ...rules, rim: 0 }, true).edgeInk).toBeGreaterThan(0.2);
    expect(assessQuality(page, { ...rules, rim: 0 }, false).edgeInk).toBe(0);
  });

  it("glare needs the rest of the paper to be visibly darker than white", () => {
    const grey = { data: new Uint8Array(100).fill(200), width: 10, height: 10 };
    grey.data.fill(255, 0, 30);
    expect(assessQuality(grey, { ...rules, rim: 0 }, false).glareShare).toBeCloseTo(0.3);
    expect(assessQuality({ data: new Uint8Array(100).fill(255), width: 10, height: 10 }, { ...rules, rim: 0 }, false).glareShare).toBe(0);
  });
});

describe("what the person is told", () => {
  it("every refusal has its words, in both languages", async () => {
    const { PHOTO_QUALITY_CODE } = await import("../photos");
    const en = (await import("../../messages/en.json")).default.console.errors as Record<string, string>;
    const fr = (await import("../../messages/fr.json")).default.console.errors as Record<string, string>;
    for (const code of Object.values(PHOTO_QUALITY_CODE)) {
      expect(en[code]).toMatch(/\S/);
      expect(fr[code]).toMatch(/\S/);
    }
  });
});
