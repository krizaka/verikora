import { Badge } from "@krizaka/ui/badge";
import { Page, Section, SectionHeading } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import type { Metadata } from "next";
import Link from "next/link";

import { AppVideoPlayer } from "@/components/download/AppVideoPlayer";
import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { frameOf, videoId, videosFor, videoUrl, wordsId } from "@/lib/app-videos";
import { DOWNLOAD_STATE, DOWNLOADS, downloadState } from "@/lib/downloads";
import { asLocale, format, getDictionary } from "@/lib/i18n";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { pagePath } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "download");
}

/** Where the apps are: a card per platform, « soon » until its link exists; then the videos the e2e tests recorded. */
export default async function Download({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale);
  // The clips of this page's language only, each in its platform's frame (content/video-frames.json: desktop 16:10 for the web and the Mac, a phone for the phone).
  const videos = videosFor(locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <SiteHeader locale={locale} current="download" />
      <main id="content">
        <PageHero
          back={{ href: pagePath(locale, "home"), label: t.meta.siteName }}
          linkAs={Link}
          title={t.download.title}
          backdrop="plain"
          lead={t.download.lead}
        />
        <Page>
          <Section>
            <ul className="grid gap-4 sm:grid-cols-3">
              {DOWNLOADS.map((download) => {
                const platform = t.download.platforms[download.id];
                const available = downloadState(download) === DOWNLOAD_STATE.available;
                return (
                  <li
                    key={download.id}
                    className="flex flex-col gap-3 rounded-lg border border-border-default p-5"
                    data-state={downloadState(download)}
                  >
                    <h2 className="text-lg font-semibold">{platform.name}</h2>
                    <p className="text-sm text-fg-secondary">{platform.body}</p>
                    {available && download.href ? (
                      <a className="text-sm font-medium text-accent underline" href={download.href}>
                        {t.download.get}
                      </a>
                    ) : (
                      <Badge>{t.download.soon}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
          {videos.length > 0 && (
            <Section divider>
              <SectionHeading title={t.download.videos.title} lead={t.download.videos.lead} />
              <ul className="grid gap-6 sm:grid-cols-2">
                {videos.map((video) => {
                  const words = t.download.videos.items[wordsId(video) as keyof typeof t.download.videos.items];
                  const shape = frameOf(video.platform);
                  if (!shape) {
                    return null;
                  }
                  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                    new Date(video.capturedAt),
                  );
                  return (
                    <li key={videoId(video)} className="flex flex-col gap-3" data-video={videoId(video)}>
                      <AppVideoPlayer
                        poster={videoUrl(video.files.poster)}
                        webm={videoUrl(video.files.webm)}
                        mp4={videoUrl(video.files.mp4)}
                        {...shape}
                        play={t.download.videos.play}
                        label={words.name}
                      />
                      <h3 className="text-base font-semibold">{words.name}</h3>
                      <p className="text-sm text-fg-secondary">{words.body}</p>
                      <p className="text-xs text-fg-muted">
                        {format(t.download.videos.recorded, { date })} ·{" "}
                        {format(t.download.videos.seconds, { seconds: String(Math.round(video.seconds)) })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </Page>
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}
