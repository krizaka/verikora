#!/usr/bin/env node
// Post-deploy check of the download page, per language (verikora#1968): the /en page shows only English clips, the /fr page French ones,
// each in its platform's frame, every poster answers, and no iOS clip exists. Public page, no secret.
//   node scripts/check-download-page.mjs --base https://dev.verikora.com
import { readFileSync } from "node:fs";

import { flagReader } from "./lib/recording-kit.mjs";

const LOCALES = ["en", "fr"];
const frames = JSON.parse(readFileSync(new URL("../apps/web/content/video-frames.json", import.meta.url), "utf8"));
const ratioOf = (f) => f.width / f.height;

/** The clips of a page's HTML: [{ id, ratio, poster }] read from `data-video`, the player's `aspect-ratio` and its poster. */
export function clipsOf(html) {
  return [...html.matchAll(/<li[^>]*data-video="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
    id: m[1],
    ratio: (() => {
      const r = /aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(m[2]);
      return r ? Number(r[1]) / Number(r[2]) : undefined;
    })(),
    poster: /(?:poster|src)="(https:[^"]+\.jpg)"/.exec(m[2])?.[1],
  }));
}

/** The problems of one page: a list of sentences, empty when the page is right. */
export function problemsOf(html, locale) {
  const problems = [];
  for (const clip of clipsOf(html)) {
    const [platform] = clip.id.split("-");
    const language = /-(en|fr)$/.exec(clip.id)?.[1];
    if (language !== locale) problems.push(`${clip.id}: a "${language}" clip on the /${locale} page`);
    const name = frames.platforms[platform];
    if (!name) problems.push(`${clip.id}: platform "${platform}" has no frame`);
    else if (!clip.ratio || Math.abs(clip.ratio - ratioOf(frames.frames[name])) > 0.01)
      problems.push(`${clip.id}: framed ${clip.ratio} instead of the ${name} frame`);
    if (!clip.poster) problems.push(`${clip.id}: no poster`);
  }
  return problems;
}

async function main() {
  const base = flagReader(process.argv.slice(2))("base", "https://dev.verikora.com");
  const failures = [];
  for (const locale of LOCALES) {
    const res = await fetch(`${base}/${locale}/download`);
    if (!res.ok) {
      failures.push(`/${locale}/download answers ${res.status}`);
      continue;
    }
    const html = await res.text();
    failures.push(...problemsOf(html, locale).map((p) => `/${locale}: ${p}`));
    for (const clip of clipsOf(html)) {
      if (!clip.poster) continue;
      const poster = await fetch(clip.poster, { method: "HEAD" });
      if (!poster.ok) failures.push(`/${locale}: ${clip.id} poster answers ${poster.status}`);
    }
    console.log(`/${locale}/download: ${clipsOf(html).length} clip(s) checked`);
  }
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
