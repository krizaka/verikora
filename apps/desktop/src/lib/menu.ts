import type { MenuSpec } from "@krizaka/app-desktop";
import { acceleratorOf } from "@krizaka/ui/app-shell";
import { type Section, sectionShortcut, sectionsFor } from "@verikora/core";

import type { Messages } from "../i18n";

/** The Mac's destinations: the one section map of `@verikora/core` (verikora#319), numbered ⌘1 to ⌘4 in the order shown. */
export const macSections = (): (Section & {
  shortcut: ReturnType<typeof sectionShortcut>;
  menuId: `go.${Section["id"]}`;
})[] =>
  sectionsFor("mac").map((section, i) => ({ ...section, shortcut: sectionShortcut(i), menuId: `go.${section.id}` }));

/** The shortcuts that are not destinations: the menu bar shows them (krizaka-ui ADR-002). */
export const SHORTCUTS = { addFolder: "mod+o", settings: "mod+," } as const;

export const MENU_IDS = { addFolder: "library.add-folder", settings: "go.settings" } as const;

/** The native menu bar in the app's words: « Aller » lists the section map, then the settings. */
export function menuSpec(t: Pick<Messages, "menu" | "sections">): MenuSpec {
  const { file, addFolder, go, settings, ...labels } = t.menu;
  const item = (id: keyof typeof MENU_IDS, label: string, separated = false) => ({
    id: MENU_IDS[id],
    label,
    accelerator: acceleratorOf(SHORTCUTS[id]),
    separated,
  });
  const destinations = macSections().map((s) => ({
    id: s.menuId,
    label: t.sections[s.id],
    accelerator: acceleratorOf(s.shortcut),
    separated: false,
  }));
  return {
    labels,
    menus: [
      { title: file, items: [item("addFolder", addFolder)] },
      { title: go, items: [...destinations, item("settings", settings, true)] },
    ],
  };
}
