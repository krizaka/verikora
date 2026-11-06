import { readFileSync } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_VIDEOS,
  frameOf,
  FRAMES,
  localeOf,
  MAX_AGE_DAYS,
  staleVideos,
  videoId,
  videosFor,
  wordsId,
} from "./app-videos";
import { getDictionary, LOCALES } from "./i18n";

const ROOT = join(__dirname, "..");
const PATH = /^sites\/verikora\/download\/(web|android|ios|mac)-[a-z0-9-]+\.[0-9a-f]{10}\.(webm|mp4|jpg)$/;

describe("the download page's videos (krizaka/.github#315)", () => {
  it("are known to the manifest with a file of each kind, hashed, under the product's download folder", () => {
    expect(APP_VIDEOS.length).toBeGreaterThan(0);
    for (const v of APP_VIDEOS) {
      expect(Object.keys(v.files).sort()).toEqual(["mp4", "poster", "webm"]);
      for (const path of Object.values(v.files)) expect(path, videoId(v)).toMatch(PATH);
      expect(v.seconds, videoId(v)).toBeLessThanOrEqual(30);
    }
  });

  it("names only Bunny layout v2 (ADR-014): the manifest is the media root and no path starts with the legacy site/ or products/", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "content/app-videos.json"), "utf8")) as { cdn: string };
    expect(manifest.cdn).toBe("https://krizaka-assets.b-cdn.net");
    for (const v of APP_VIDEOS)
      for (const path of Object.values(v.files)) expect(path).not.toMatch(/^(site|products)\//);
  });

  it.each(LOCALES)(
    "each video has its words in %s (the words may come first: the automated manifest pull request must pass)",
    (locale) => {
      const items = getDictionary(locale).download.videos.items as Record<string, { name: string; body: string }>;
      const ids = APP_VIDEOS.map(wordsId);
      for (const id of ids) {
        expect(items[id], `${locale}: ${id}`).toBeDefined();
        expect(items[id]?.name).not.toBe("");
        expect(items[id]?.body).not.toBe("");
      }
    },
  );

  // verikora#1968: the Mac clip was shown in a phone frame, and French recordings on /en.
  it("every clip says its language (its flow ends with -en or -fr) and has a frame: nothing falls back to another platform's shape", () => {
    for (const v of APP_VIDEOS) {
      expect(localeOf(v), `${videoId(v)} has no -en/-fr suffix`).toBeDefined();
      expect(frameOf(v.platform), `${v.platform} has no frame in content/video-frames.json`).toBeDefined();
    }
  });

  it("the Mac and the web are framed as a desktop (16:10), a phone as a phone: a Mac clip is never in a phone frame", () => {
    expect(frameOf("mac")).toEqual(FRAMES.desktop);
    expect(frameOf("web")).toEqual(FRAMES.desktop);
    expect(frameOf("android")).toEqual(FRAMES.phone);
    expect(FRAMES.desktop.width).toBeGreaterThan(FRAMES.desktop.height);
    expect(FRAMES.phone.height).toBeGreaterThan(FRAMES.phone.width);
    expect(frameOf("tv")).toBeUndefined();
  });

  it.each(LOCALES)("%s shows only its own language's clips", (locale) => {
    const shown = videosFor(locale);
    for (const v of shown) {
      expect(localeOf(v)).toBe(locale);
    }
    expect(
      videosFor(locale, [
        { ...APP_VIDEOS[0]!, flow: "binder-en" },
        { ...APP_VIDEOS[0]!, flow: "binder-fr" },
      ]).map((v) => localeOf(v)),
    ).toEqual([locale]);
  });

  it("no iOS clip exists until an iOS flow does (the iPhone card never shows another platform's film)", () => {
    const flows = existsSync(join(ROOT, "../mobile")) ? readdirSync(join(ROOT, "../mobile/.maestro-showcase")) : [];
    const hasIosFlow = flows.some((f) => f.startsWith("ios-"));
    if (!hasIosFlow) {
      expect(APP_VIDEOS.filter((v) => v.platform === "ios")).toEqual([]);
    }
  });

  it("the page reads the manifest only: no address of a video is typed in it", () => {
    const page = readFileSync(join(ROOT, "app/[locale]/download/page.tsx"), "utf8");
    expect(page).toContain("videosFor");
    expect(page).not.toMatch(/b-cdn|(?:site|sites)\/|products\/verikora|\.(mp4|webm|jpg)["'`]/);
  });

  it(`none is older than ${MAX_AGE_DAYS} days: a stale recording means the e2e job stopped publishing`, () => {
    expect(staleVideos(new Date()).map(videoId)).toEqual([]);
  });

  it("staleVideos tells a fresh recording from an old one", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const v = (capturedAt: string) => ({
      platform: "web",
      flow: "x",
      seconds: 5,
      capturedAt,
      files: { webm: "", mp4: "", poster: "" },
    });
    expect(staleVideos(now, [v("2026-11-07T00:00:01Z")])).toEqual([]);
    expect(staleVideos(now, [v("2026-11-05T00:00:00Z")])).toHaveLength(1);
  });

  it("the page says nothing of stores or availability beyond the platform cards", () => {
    for (const locale of LOCALES) {
      const { title, lead, play, recorded, seconds } = getDictionary(locale).download.videos;
      expect([title, lead, play, recorded, seconds].join(" ")).not.toMatch(
        /App Store|Google Play|TestFlight|disponible|available/i,
      );
    }
  });
});
