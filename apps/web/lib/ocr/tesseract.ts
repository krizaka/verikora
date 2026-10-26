import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { normaliseText } from "../pdf-text";
import { type OcrEngine, OcrError, type OcrPage, type OcrWord } from "./port";

const require = createRequire(import.meta.url);

/**
 * One folder holding every language's trained data: Tesseract takes a single folder, and each `@tesseract.js-data/<lang>` package
 * has its own. The files are copied once, from the packages (never downloaded: the server makes no call out to read a document).
 */
let dataDir: string | null = null;

/** Where a language's trained data is: from the package when Node can resolve it (development, tests), else from the pnpm store the image carries (the build's bundle resolves from its own folder, where the package is not linked). */
function trainedData(lang: string): string {
  const file = `${lang}.traineddata.gz`;
  try {
    return path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), "4.0.0_best_int", file);
  } catch {
    for (const store of [path.join(process.cwd(), "node_modules", ".pnpm"), path.join(process.cwd(), "..", "..", "node_modules", ".pnpm")]) {
      const dir = existsSync(store) ? readdirSync(store).find((d) => d.startsWith(`@tesseract.js-data+${lang}@`)) : undefined;
      if (dir) return path.join(store, dir, "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", file);
    }
    throw new OcrError("OCR_FAILED");
  }
}
function languageData(languages: readonly string[]): string {
  if (dataDir && languages.every((l) => existsSync(path.join(dataDir!, `${l}.traineddata.gz`)))) return dataDir;
  const dir = path.join(os.tmpdir(), "yomizaka-tessdata");
  mkdirSync(dir, { recursive: true });
  for (const lang of languages) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    if (!existsSync(target)) copyFileSync(trainedData(lang), target);
  }
  dataDir = dir;
  return dir;
}

const TIMEOUT_MS = 90_000;

/** The words of a recognised page with their boxes, in reading order (blocks → paragraphs → lines → words). */
export function wordsOf(blocks: ReadonlyArray<{ paragraphs: ReadonlyArray<{ lines: ReadonlyArray<{ words: ReadonlyArray<{ text: string; bbox: OcrWord["bbox"] }> }> }> }> | null | undefined): OcrWord[] {
  return (blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } })))));
}

/**
 * Tesseract (Apache-2.0, WebAssembly) in-process: free, local, no network. One worker per document, ended when it is read, so
 * no engine memory is held between uploads. Pages are read one after the other.
 */
export function tesseractEngine(): OcrEngine {
  return {
    name: "tesseract",
    async read(images, languages) {
      // The worker answers a non-image with an event nobody can catch: only what is plainly a JPEG or a PNG reaches it.
      if (!images.length || images.some((b) => !(b[0] === 0xff && b[1] === 0xd8) && !(b[0] === 0x89 && b[1] === 0x50))) throw new OcrError("OCR_FAILED");
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker([...languages], 1, { langPath: languageData(languages), gzip: true, cachePath: os.tmpdir(), cacheMethod: "write" }).catch((error: unknown) => {
        throw new OcrError("OCR_FAILED", error);
      });
      const timer = setTimeout(() => void worker.terminate(), TIMEOUT_MS);
      try {
        const pages: OcrPage[] = [];
        for (const image of images) {
          const { data } = await worker.recognize(Buffer.from(image), {}, { blocks: true });
          pages.push({ text: normaliseText(data.text), confidence: data.confidence, words: wordsOf(data.blocks) });
        }
        const weight = pages.map((p) => Math.max(1, p.text.replace(/\s/g, "").length));
        const total = weight.reduce((a, b) => a + b, 0);
        const confidence = pages.reduce((sum, p, i) => sum + p.confidence * weight[i]!, 0) / total;
        return { text: pages.map((p) => p.text).join("\n\n"), confidence, pages };
      } catch (error) {
        throw new OcrError("OCR_FAILED", error);
      } finally {
        clearTimeout(timer);
        await worker.terminate().catch(() => undefined);
      }
    },
  };
}
