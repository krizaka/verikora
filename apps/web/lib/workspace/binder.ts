import type { StatusSet, ViewFilters } from "@krizaka/organize/contract";

/** The binder's tab hues are the set's tones (the colour is never the only signal: the words and the count say it). */
const HUE = { success: "success", warning: "warning", danger: "danger", neutral: "neutral", info: "accent" } as const;
export type BinderHue = (typeof HUE)[keyof typeof HUE];

export interface BinderTab {
  /** The decision state the tab shows, or null for « Tous ». */
  state: string | null;
  label: { fr: string; en: string } | null;
  hue: BinderHue;
  /** The filters of the tab's view: the address's, with the decision replaced by the tab's. These are also what its count counts. */
  filters: ViewFilters;
}

export interface BinderChip {
  id: string;
  /** The filters of the chip's view: the address's, with the tag toggled. Its count counts the files that wear it with the rest of the address. */
  filters: ViewFilters;
  /** The count of the chip: the files that wear the tag, within the address's other filters. */
  countFilters: ViewFilters;
  on: boolean;
}

const without = (f: ViewFilters, key: keyof ViewFilters): ViewFilters => {
  const rest = { ...f };
  delete rest[key];
  return rest;
};

/**
 * The binder of « Dossiers » (verikora#334, design B2): a tab per decision state of the set, plus « Tous », and a chip per tag.
 * Each tab and chip carries the filters it opens — and **the same filters are what its count counts** (`filterSql`, as the list), so the
 * numbers on the tabs are the lengths of the views. Pure.
 */
export function binderPlan(
  set: StatusSet,
  tagIds: readonly string[],
  filters: ViewFilters,
): { tabs: BinderTab[]; chips: BinderChip[]; activeState: string | null } {
  const noState = without(filters, "status");
  const tabs: BinderTab[] = [
    { state: null, label: null, hue: "accent", filters: noState },
    ...set.states.map((s): BinderTab => ({
      state: s.key,
      label: s.label,
      hue: HUE[s.tone as keyof typeof HUE] ?? "neutral",
      filters: { ...noState, status: [s.key] },
    })),
  ];
  const worn = filters.tags ?? [];
  const chips = tagIds.map((id): BinderChip => {
    const on = worn.includes(id);
    const next = on ? worn.filter((t) => t !== id) : [...worn, id];
    return {
      id,
      on,
      filters: next.length ? { ...filters, tags: next } : without(filters, "tags"),
      countFilters: { ...filters, tags: Array.from(new Set([...worn, id])) },
    };
  });
  const status = filters.status ?? [];
  const activeOf = () => {
    if (status.length === 0) return null;
    return status.length === 1 ? status[0]! : "multiple";
  };
  return { tabs, chips, activeState: activeOf() };
}
