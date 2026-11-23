import { z } from "zod";

import data from "@/content/media-registry.json";

import { APP_VIDEOS, type AppVideo, frameOf, videosFor, videoUrl, wordsId } from "./app-videos";
import type { Locale } from "./i18n";

const registry = z.object({
  media: z.array(
    z.object({
      /** A recording's words id (`web-binder`): its flow in content/app-videos.json, without the language. */
      id: z.string(),
      /** Where it comes from: `test` (recorded by the e2e tests), `design`, `founder`. */
      origin: z.string(),
      owner: z.string(),
      location: z.string(),
      /** The page sections that show it, by role. */
      uses: z.array(z.object({ page: z.string(), role: z.string() })),
    }),
  ),
});
export type MediaRegistry = z.infer<typeof registry>;

/** The registry of the pages' media, parsed once: `content/media-registry.json` (krizaka-internal#4634, #4482). */
export const MEDIA_REGISTRY: MediaRegistry = registry.parse(data);

/** One media to show: its words id (its name and caption in the messages), its addresses and its frame. */
export interface RoleMedia {
  id: string;
  video: AppVideo;
  poster: string;
  webm: string;
  mp4: string;
  width: number;
  height: number;
}

/**
 * The media of one page section, by role: every registry entry used there, as the recordings of the page's language (never
 * another language's clip, #1968), in the registry's order. The page asks « the media of role R on page P »; the registry answers.
 */
export function sectionMedia(
  page: string,
  role: string,
  locale: Locale,
  media: MediaRegistry = MEDIA_REGISTRY,
  videos: readonly AppVideo[] = APP_VIDEOS,
): RoleMedia[] {
  const ids = media.media.filter((m) => m.uses.some((u) => u.page === page && u.role === role)).map((m) => m.id);
  const ofLocale = videosFor(locale, videos);
  return ids.flatMap((id) =>
    ofLocale
      .filter((v) => wordsId(v) === id)
      .flatMap((video) => {
        const frame = frameOf(video.platform);
        if (!frame) {
          return [];
        }
        return [
          {
            id,
            video,
            poster: videoUrl(video.files.poster),
            webm: videoUrl(video.files.webm),
            mp4: videoUrl(video.files.mp4),
            ...frame,
          },
        ];
      }),
  );
}
