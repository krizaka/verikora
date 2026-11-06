// The markers of a film (verikora#1968, « bug means a missing guard »): while a showcase journey runs, it probes the page and
// writes `<film>.markers.json`; `film-trim.mjs` refuses a film whose markers show an error, an empty state or the dev banner, whose
// language is not the one in its name, whose shape is not its platform's frame, or that does not end on a result.
// Pure parts here (tested by film-markers.test.mjs); the probe runs in the page.
import { readFileSync } from "node:fs";

// @fixed: a clip's aspect ratio may differ from its frame's by this share (an emulator's 20:9 is not the box's 19.5:9)
export const RATIO_TOLERANCE = 0.05;

/** The frames of the download page (the same file the page reads): { frames: {name: {width, height}}, platforms: {platform: name} }. */
export const framesOf = () =>
  JSON.parse(readFileSync(new URL("../apps/web/content/video-frames.json", import.meta.url), "utf8"));

/** Runs in the page: what is on screen right now. `result` is the journey's own selector of its outcome. */
export function probe(resultSelector) {
  const shown = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const any = (selector) => [...document.querySelectorAll(selector)].some(shown);
  return {
    lang: document.documentElement.lang,
    error: any('[data-testid$="-error"], [role="alert"]'),
    empty: any('[data-testid$="-empty"]'),
    devBanner: any("[data-top-chrome], [data-stage]"),
    result: any(resultSelector),
  };
}

/** `web-binder-en.webm` -> { platform: "web", flow: "binder", locale: "en" }; null when the name does not say its language. */
export function parseFilmName(name) {
  const m = /^([a-z0-9]+)-([a-z0-9-]+?)-(en|fr)\.(?:webm|mp4)$/.exec(name);
  return m ? { platform: m[1], flow: m[2], locale: m[3] } : null;
}

/** Throws when a film must not be published. `size` is the film's { width, height } read by ffprobe. */
export function assertFilm({ name, markers, size, frames = framesOf() }) {
  const id = parseFilmName(name);
  if (!id) throw new Error(`${name}: the name must be <platform>-<flow>-<en|fr>`);
  const frameName = frames.platforms[id.platform];
  if (!frameName) throw new Error(`${name}: platform "${id.platform}" has no frame (content/video-frames.json)`);
  const frame = frames.frames[frameName];
  const ratio = size.width / size.height;
  const wanted = frame.width / frame.height;
  if (Math.abs(ratio - wanted) / wanted > RATIO_TOLERANCE)
    throw new Error(
      `${name}: ${size.width}x${size.height} is not the shape of the ${frameName} frame (${frame.width}x${frame.height})`,
    );
  if (!markers?.frames?.length) throw new Error(`${name}: no markers were recorded during the journey`);
  markers.frames.forEach((f, i) => {
    if (f.lang !== id.locale) throw new Error(`${name}: marker ${i} is in "${f.lang}", the film is for "${id.locale}"`);
    if (f.error) throw new Error(`${name}: marker ${i} shows an error state`);
    if (f.empty) throw new Error(`${name}: marker ${i} shows an empty state`);
    if (f.devBanner) throw new Error(`${name}: marker ${i} shows the development banner (showcase mode hides it)`);
  });
  if (!markers.frames.at(-1).result) throw new Error(`${name}: the film does not end on its result`);
}
