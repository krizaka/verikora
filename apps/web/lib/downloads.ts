import { APP_VIDEOS, type AppVideo } from "./app-videos";

/**
 * Where the apps can be downloaded: structure only (the words are `download.platforms.<id>`). A platform shows « soon »
 * until its link exists: TestFlight or the App Store for iOS, a release asset for Android and the Mac. Never a dead button.
 */
export const DOWNLOAD_PLATFORM = { ios: "ios", android: "android", mac: "mac" } as const;
export type DownloadPlatform = (typeof DOWNLOAD_PLATFORM)[keyof typeof DOWNLOAD_PLATFORM];

export interface Download {
  id: DownloadPlatform;
  /** The store, TestFlight or release address; null while there is none. */
  href: string | null;
}

export const DOWNLOADS: readonly Download[] = [
  { id: DOWNLOAD_PLATFORM.ios, href: null },
  { id: DOWNLOAD_PLATFORM.android, href: null },
  { id: DOWNLOAD_PLATFORM.mac, href: null },
];

export const DOWNLOAD_STATE = { available: "available", soon: "soon" } as const;
export type DownloadState = (typeof DOWNLOAD_STATE)[keyof typeof DOWNLOAD_STATE];

export const downloadState = (download: Download): DownloadState =>
  download.href ? DOWNLOAD_STATE.available : DOWNLOAD_STATE.soon;

/** Whether any app can be downloaded. While none can, `/download` answers 308 to the home and is in neither the footer nor the sitemap (verikora#389). */
export const downloadsOffered = (downloads: readonly Download[] = DOWNLOADS): boolean =>
  downloads.some((d) => downloadState(d) === DOWNLOAD_STATE.available);

/** Whether `/download` is public: an app can be downloaded, or the e2e tests recorded a video of one (krizaka/.github#315). Parked otherwise. */
export const downloadPageOpen = (
  downloads: readonly Download[] = DOWNLOADS,
  videos: readonly AppVideo[] = APP_VIDEOS,
): boolean => downloadsOffered(downloads) || videos.length > 0;
