import { AppVideoPlayer } from "@/components/download/AppVideoPlayer";
import { getDictionary, type Locale } from "@/lib/i18n";
import { sectionMedia } from "@/lib/section-media";

/**
 * The media of one page section, by role (`lib/section-media.ts`): each recording with its name and what it shows, and one note
 * that says where it comes from (our tests, fictitious demo data). Nothing when the registry lists none for this section.
 */
export function SectionMedia({ page, role, locale }: Readonly<{ page: string; role: string; locale: Locale }>) {
  const media = sectionMedia(page, role, locale);
  if (media.length === 0) {
    return null;
  }
  const t = getDictionary(locale);
  const items: Readonly<Record<string, { name: string; body: string } | undefined>> = t.download.videos.items;
  return (
    <div className="my-6 flex max-w-3xl flex-col gap-6" data-testid={`media-${page}-${role}`}>
      {media.map((m) => {
        const words = items[m.id];
        return (
          <figure key={m.video.flow} className="m-0 flex flex-col gap-3" data-media={m.id}>
            <AppVideoPlayer
              poster={m.poster}
              webm={m.webm}
              mp4={m.mp4}
              width={m.width}
              height={m.height}
              play={t.download.videos.play}
              label={words?.name ?? ""}
            />
            <figcaption className="flex max-w-[70ch] flex-col gap-1 text-sm text-fg-secondary">
              <span className="font-semibold text-fg-primary">{words?.name}</span>
              <span>{words?.body}</span>
              <span className="text-xs text-fg-muted">{t.chrome.media.recorded}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
