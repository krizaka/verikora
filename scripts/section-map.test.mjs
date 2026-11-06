import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SECTION_IDS } from "../packages/core/src/sections.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

/** One section map, read by the three apps (§ 3.6 of the design direction, verikora#319). */
describe("the web, the phone and the Mac draw the same section map", () => {
  const readers = {
    web: "apps/web/components/console/ConsoleShell.tsx",
    phone: "apps/mobile/src/domain/tabs.ts",
    mac: "apps/desktop/src/lib/menu.ts",
  };

  it.each(Object.entries(readers))(
    "%s imports the list from @verikora/core and asks for its own platform",
    (platform, file) => {
      const src = read(file);
      expect(src).toMatch(/import \{[^}]*\bsectionsFor\b[^}]*\} from "@verikora\/core"/);
      expect(src).toContain(`sectionsFor("${platform}"`);
    },
  );

  it("keeps no destination list of its own: the phone's tab bar and the Mac's sidebar are drawn from the map", () => {
    const phone = read("apps/mobile/app/[locale]/app/_layout.tsx");
    expect(phone).toContain("phoneTabs(");
    expect(phone).not.toMatch(/type TabName = /);
    expect(phone).not.toContain('t("tabs.settings")');
    expect(phone).not.toContain('t("tabs.verify")');
    const mac = read("apps/desktop/src/App.tsx");
    expect(mac).toContain("macSections(");
    for (const old of ["nav.library", "nav.batches", "nav.reports"]) expect(mac).not.toContain(`t("${old}")`);
  });

  it("labels every section under the same key, sections.<id>, in FR and EN", () => {
    for (const locale of ["fr", "en"]) {
      const web = json(`apps/web/messages/${locale}.json`).console.sections;
      const apps = json(`packages/client/src/messages/${locale}.json`).sections;
      for (const id of SECTION_IDS) {
        expect(web?.[id], `web ${locale} ${id}`).toBeTruthy();
        expect(apps?.[id], `apps ${locale} ${id}`).toBeTruthy();
      }
      expect(apps.library).toBe(web.library);
      expect(apps.checks).toBe(web.checks);
    }
  });
});
