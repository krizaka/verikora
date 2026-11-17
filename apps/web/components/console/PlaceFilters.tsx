"use client";

import { type ActiveFilter, FilterBar, FilterMenu } from "@krizaka/ui/filter-bar";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type ItemKind, type TagOption, TagsDialog } from "@/components/console/OrganisationActions";
import { useSay } from "@/lib/i18n-client";
import { libraryViewHref, type ViewState } from "@/lib/organisation/rules";
import { pluralKey } from "@/lib/plural";

/** The one option of the menu while the library has no tag: it opens the place's tags dialog instead of filtering. */
const CREATE = "__create__";

/** The place whose tags dialog the « Créer une étiquette » entry opens (a collection or a folder, with the tags it wears). */
export type PlaceTags = { kind: ItemKind; id: string; tags: TagOption[]; current: string[] };

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
  place,
}: Readonly<{
  tags: { id: string; name: string }[];
  selected: string[];
  path: string;
  view: ViewState;
  count: number;
  place?: PlaceTags;
}>) {
  const { say } = useSay();
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const go = (ids: string[]) => router.push(libraryViewHref(path, { ...view, tags: ids }), { scroll: false });
  const active: ActiveFilter[] = selected.flatMap((id) => {
    const tag = tags.find((t) => t.id === id);
    return tag ? [{ id: `tag:${id}`, label: tag.name, onRemove: () => go(selected.filter((x) => x !== id)) }] : [];
  });
  const options =
    tags.length === 0 && place
      ? [{ value: CREATE, label: say("organisation.createTag") }]
      : tags.map((t) => ({ value: t.id, label: t.name }));
  const choose = (ids: string[]) => (ids.includes(CREATE) ? setCreating(true) : go(ids));
  return (
    <>
      <FilterBar
        label={say("organisation.filterTags")}
        active={active}
        onClearAll={() => go([])}
        clearLabel={say("organisation.clearTags")}
        removeLabel={(label) => say("organisation.removeTag", { label })}
        results={say(pluralKey("organisation.files", count), { count })}
        data-testid="place-filters"
      >
        <FilterMenu label={say("organisation.filterTags")} options={options} value={selected} onValueChange={choose} />
      </FilterBar>
      {creating && place ? (
        <TagsDialog
          kind={place.kind}
          id={place.id}
          tags={place.tags}
          current={place.current}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
