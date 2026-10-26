import type { OcrEngine, OcrRules, OcrWord, PhotoOrigin, TextSource, VisionReader } from "./port";

/**
 * Reads the text of cleaned photos: the local engine first (free); the vision fallback only when the local reading is not
 * trusted (low confidence, or almost no text), and only if one is configured. The answer says which one read it — a model's
 * reading is never presented as the local engine's. A fallback that fails or is unavailable leaves the local text, flagged.
 */
export async function readPhotoText(images: readonly Uint8Array[], deps: { ocr: OcrEngine; vision?: VisionReader | null; rules: OcrRules; origin?: PhotoOrigin | null }): Promise<{ text: string; source: TextSource; words?: OcrWord[][] }> {
  const { ocr, vision, rules } = deps;
  const origin = deps.origin ?? null;
  const local = await ocr.read(images, rules.languages);
  const trusted = local.confidence >= rules.minConfidence && local.text.replace(/\s/g, "").length >= rules.minChars;
  // The words with their boxes go along only with the local reading: they are what its text was made of.
  const words = local.pages.map((p) => p.words ?? []);
  if (trusted) return { text: local.text, words, source: { kind: "ocr", engine: ocr.name, confidence: Math.round(local.confidence), photos: images.length, lowConfidence: false, origin } };
  const remote = vision ? await vision.read(images, rules.languages).catch(() => null) : null;
  if (remote?.text.trim()) return { text: remote.text, source: { kind: "vision", by: "orazaka", runId: remote.runId, model: remote.model, localConfidence: Math.round(local.confidence), photos: images.length, origin } };
  return { text: local.text, words, source: { kind: "ocr", engine: ocr.name, confidence: Math.round(local.confidence), photos: images.length, lowConfidence: true, origin } };
}
