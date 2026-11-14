"use client";

import { type ActiveFilter, FilterBar, FilterMenu } from "@krizaka/ui/filter-bar";
import { useRouter } from "next/navigation";

import { useSay } from "@/lib/i18n-client";
import { libraryViewHref, type ViewState } from "@/lib/organisation/rules";
import { pluralKey } from "@/lib/plural";

/**
 * The tags of a place as a filter bar (the UX review's Y7): a menu of the tags, the ones in force as removable chips, « Effacer le
 * filtre », the count of files — the `?tags=` of the address, as before (the URL is the state: a filtered place is a link, Back undoes a tag).
 */
export function PlaceFilters({
  tags,
  selected,
  path,
  view,
  count,
}: Readonly<{
  tags: { id: string; name: string }[];
  selected: string[];
  path: string;
  view: ViewState;
  count: number;
}>) {
  const { say } = useSay();
  const router = useRouter();
  const go = (ids: string[]) => router.push(libraryViewHref(path, { ...view, tags: ids }), { scroll: false });
  const active: ActiveFilter[] = selected.flatMap((id) => {
    const tag = tags.find((t) => t.id === id);
    return tag ? [{ id: `tag:${id}`, label: tag.name, onRemove: () => go(selected.filter((x) => x !== id)) }] : [];
  });
  return (
    <FilterBar
      label={say("organisation.filterTags")}
      active={active}
      onClearAll={() => go([])}
      clearLabel={say("organisation.clearTags")}
      removeLabel={(label) => say("organisation.removeTag", { label })}
      results={say(pluralKey("organisation.files", count), { count })}
      data-testid="place-filters"
    >
      <FilterMenu
        label={say("organisation.filterTags")}
        options={tags.map((t) => ({ value: t.id, label: t.name }))}
        value={selected}
        onValueChange={go}
      />
    </FilterBar>
  );
}
