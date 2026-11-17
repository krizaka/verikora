import { TagChip } from "@krizaka/ui/chip";

import type { TagColor } from "@/lib/organisation/rules";

/**
 * The tags of an item, read only: the name beside its marker of the closed palette (never colour alone). `more` tags the row does not
 * name are counted as « +N » (`moreLabel` says it for a screen reader).
 */
export function TagChips({
  tags,
  more = 0,
  moreLabel,
}: Readonly<{
  tags: { id: string; name: string; color: TagColor }[];
  more?: number;
  moreLabel?: (count: number) => string;
}>) {
  if (!tags.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
      {tags.map((t) => (
        <li key={t.id}>
          <TagChip marker={t.color} size="sm">
            {t.name}
          </TagChip>
        </li>
      ))}
      {more > 0 ? (
        <li className="text-xs text-fg-secondary" aria-label={moreLabel?.(more)}>
          +{more}
        </li>
      ) : null}
    </ul>
  );
}
