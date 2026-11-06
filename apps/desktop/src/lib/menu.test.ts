import { describe, expect, it } from "vitest";

import sharedEn from "@verikora/client/messages/en.json";
import sharedFr from "@verikora/client/messages/fr.json";
import { sectionsFor } from "@verikora/core";
import { describe as group } from "vitest";

import ownEn from "../i18n/own.en.json";
import ownFr from "../i18n/own.fr.json";
import { MENU_IDS, macSections, menuSpec } from "./menu";
import { sectionOf } from "./route";

const fr = { ...ownFr, ...sharedFr };
const en = { ...ownEn, ...sharedEn };

describe("the native menu bar", () => {
  it("is built in the app's words, its « Aller » menu from the section map with ⌘1 to ⌘4 (verikora#319)", () => {
    const spec = menuSpec(fr);
    expect(spec.labels.quit).toBe("Quitter Verikora");
    expect(spec.menus.map((m) => m.title)).toEqual(["Fichier", "Aller"]);
    expect(spec.menus.flatMap((m) => m.items.map((i) => [i.id, i.label, i.accelerator]))).toEqual([
      [MENU_IDS.addFolder, fr.menu.addFolder, "CmdOrCtrl+O"],
      ...sectionsFor("mac").map((section, i) => [`go.${section.id}`, fr.sections[section.id], `CmdOrCtrl+${i + 1}`]),
      [MENU_IDS.settings, fr.menu.settings, "CmdOrCtrl+,"],
    ]);
    expect(spec.menus[1]?.items.slice(0, 2).map((i) => i.label)).toEqual(["Accueil", "Vérifications"]);
    expect(Object.keys(spec.labels).sort()).toEqual(Object.keys(menuSpec(en).labels).sort());
  });

  it("uses ids and labels the native side accepts (lowercase ids, labels of 1 to 60 characters)", () => {
    for (const messages of [fr, en]) {
      const spec = menuSpec(messages);
      for (const item of spec.menus.flatMap((m) => m.items)) {
        expect(item.id).toMatch(/^[a-z][a-z0-9.-]*$/);
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.label.length).toBeLessThanOrEqual(60);
      }
      for (const label of Object.values(spec.labels)) expect(label.length).toBeLessThanOrEqual(60);
    }
  });
});

group("the Mac's sidebar (verikora#319)", () => {
  it("is the section map: Bibliothèque then Vérifications, numbered in the order shown", () => {
    expect(macSections().map((s) => [s.id, s.shortcut])).toEqual(
      sectionsFor("mac").map((s, i) => [s.id, `mod+${i + 1}`]),
    );
  });
  it("holds the batches (« Lots ») inside Vérifications, never as a destination of their own", () => {
    expect(macSections().map((s) => s.id)).not.toContain("batches");
    expect(macSections().find((s) => s.id === "checks")?.tabs).toEqual(["checks", "lots"]);
    expect(sectionOf({ screen: "batches" })).toBe("checks");
    expect(sectionOf({ screen: "batch", batchId: "b" })).toBe("checks");
    expect(sectionOf({ screen: "reports" })).toBe("checks");
  });
});
