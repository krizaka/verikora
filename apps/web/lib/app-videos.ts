import manifest from "../content/app-videos.json";
import frames from "../content/video-frames.json";
import type { Locale } from "./i18n";

/**
 * The videos of the download page: recorded by the e2e tests (krizaka/.github#315, the `app-videos` workflow), uploaded to Bunny,
 * listed in `content/app-videos.json` by an automated pull request. The page reads only this list; never a typed URL.
 */
export interface AppVideo {
  platform: string;
  flow: string;
  seconds: number;
  capturedAt: string;
  files: { webm: string; mp4: string; poster: string };
}

export const APP_VIDEOS: readonly AppVideo[] = manifest.videos;

/** A video older than this is stale: the daily watch `.github/workflows/stale-videos.yml` raises the alert `stale-videos/verikora`, so the recording job is looked at (#315, krizaka-internal#3626). Never a test that reads the clock. */
// @fixed: the guard of krizaka/.github#315 — a recording older than two weeks means the e2e job stopped publishing
export const MAX_AGE_DAYS = 14;

/** The id of a video in the messages (`download.videos.items.<id>`). */
export const videoId = (v: Pick<AppVideo, "platform" | "flow">): string => `${v.platform}-${v.flow}`;

/** A file of the manifest as an address of the media CDN. */
export const videoUrl = (path: string): string => `${manifest.cdn}/${path}`;

/** The videos recorded more than MAX_AGE_DAYS before `now`. */
export const staleVideos = (now: Date, videos: readonly AppVideo[] = APP_VIDEOS): AppVideo[] => {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - MAX_AGE_DAYS);
  return videos.filter((v) => new Date(v.capturedAt) < cutoff);
};

/** The frame of each kind of screen (`content/video-frames.json`, also read by `scripts/film-trim.mjs`): a clip must have its frame's aspect ratio. */
export const FRAMES = frames.frames;
export type FrameName = keyof typeof FRAMES;

/** The frame a platform's clips are shown in. A platform the map does not know has no frame, so no clip: never another platform's shape (#1968). */
export const frameOf = (platform: string): (typeof FRAMES)[FrameName] | undefined => {
  const name = (frames.platforms as Record<string, FrameName | undefined>)[platform];
  return name ? FRAMES[name] : undefined;
};

/** A clip is recorded once per page language: its flow ends with `-en` or `-fr` (`web-binder-en`), the words are shared (`web-binder`). */
const LOCALE_SUFFIX = /-(en|fr)$/;

/** The language of a clip, read from its flow; undefined for a clip that does not say (the guard refuses it). */
export const localeOf = (v: Pick<AppVideo, "flow">): Locale | undefined =>
  LOCALE_SUFFIX.exec(v.flow)?.[1] as Locale | undefined;

/** The id of a clip's words in the messages: its id without the language. */
export const wordsId = (v: Pick<AppVideo, "platform" | "flow">): string => videoId(v).replace(LOCALE_SUFFIX, "");

/** The clips of one page language (the /en page never shows a French recording, #1968). */
export const videosFor = (locale: Locale, videos: readonly AppVideo[] = APP_VIDEOS): AppVideo[] =>
  videos.filter((v) => localeOf(v) === locale && frameOf(v.platform) !== undefined);
