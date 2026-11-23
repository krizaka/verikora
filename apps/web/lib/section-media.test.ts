import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppVideo } from "./app-videos";
import { getDictionary, LOCALES } from "./i18n";
import { MEDIA_REGISTRY, type MediaRegistry, sectionMedia } from "./section-media";

const clip = (platform: string, flow: string): AppVideo => ({
  platform,
  flow,
  seconds: 4,
  capturedAt: "2026-11-22T00:00:00Z",
  files: { webm: `${flow}.webm`, mp4: `${flow}.mp4`, poster: `${flow}.jpg` },
});
const VIDEOS = [
  clip("web", "binder-en"),
  clip("web", "binder-fr"),
  clip("web", "report-fr"),
  clip("mac", "library-fr"),
];
const entry = (id: string, page: string, role: string) => ({
  id,
  origin: "test",
  owner: "verikora",
  location: "content/app-videos.json",
  uses: [{ page, role }],
});

describe("section media, read by role", () => {
  it("a page section gets the media its role lists, in the page's language only", () => {
    const registry: MediaRegistry = { media: [entry("web-binder", "home", "what")] };
    expect(sectionMedia("home", "what", "fr", registry, VIDEOS).map((m) => m.video.flow)).toEqual(["binder-fr"]);
    expect(sectionMedia("home", "what", "en", registry, VIDEOS).map((m) => m.video.flow)).toEqual(["binder-en"]);
    expect(sectionMedia("home", "proof", "fr", registry, VIDEOS)).toEqual([]);
    expect(sectionMedia("docs", "what", "fr", registry, VIDEOS)).toEqual([]);
  });

  it("adding an entry to the registry shows it, with no code change", () => {
    const before: MediaRegistry = { media: [entry("web-binder", "home", "what")] };
    const after: MediaRegistry = { media: [...before.media, entry("web-report", "home", "what")] };
    expect(sectionMedia("home", "what", "fr", before, VIDEOS)).toHaveLength(1);
    expect(sectionMedia("home", "what", "fr", after, VIDEOS).map((m) => m.id)).toEqual(["web-binder", "web-report"]);
  });

  it("an entry without a recording in the page's language shows nothing, never another language's clip", () => {
    const registry: MediaRegistry = { media: [entry("web-report", "docs", "lead")] };
    expect(sectionMedia("docs", "lead", "en", registry, VIDEOS)).toEqual([]);
  });

  it("each media gets its address from the manifest's CDN, never a typed host", () => {
    const [media] = sectionMedia("home", "what", "fr", { media: [entry("web-binder", "home", "what")] }, VIDEOS);
    expect(media?.poster).toMatch(/^https:\/\/[^/]+\/binder-fr\.jpg$/);
    expect(media?.mp4).toMatch(/\/binder-fr\.mp4$/);
    const source = readFileSync(join(__dirname, "section-media.ts"), "utf8");
    expect(source).not.toMatch(/https?:\/\//);
  });

  it.each(LOCALES)("every registered media has its words in %s (name and caption)", (locale) => {
    const items: Readonly<Record<string, { name: string; body: string } | undefined>> =
      getDictionary(locale).download.videos.items;
    for (const m of MEDIA_REGISTRY.media) {
      expect(items[m.id]?.name, m.id).toBeTruthy();
      expect(items[m.id]?.body, m.id).toBeTruthy();
    }
  });
});
