import { CHECKS_TABS, sectionsFor } from "@verikora/core";

import { routes } from "./links";
import { checksTabOf, phoneTabs } from "./tabs";

/** The phone's tab bar is the one section map (verikora#319): no list of its own. */
describe("the phone's tabs", () => {
  it("are the section map's phone row, in its order, each at the web's path", () => {
    expect(phoneTabs("fr").map((tab) => tab.id)).toEqual(sectionsFor("phone").map((s) => s.id));
    expect(phoneTabs("fr").map((tab) => [tab.id, tab.screen, tab.href])).toEqual([
      ["library", "library", "/fr/app/library"],
      ["checks", "verifications", "/fr/app/verifications"],
    ]);
  });

  it("have no « Vérifier » and no « Réglages » tab: the check is the header's « + », the settings are under the avatar", () => {
    const screens = phoneTabs("en").map((tab) => tab.screen);
    expect(screens).not.toContain("check");
    expect(screens).not.toContain("settings");
  });

  it("hold the batches as the second tab of Vérifications (« Lots »), in the address as on the web", () => {
    expect(CHECKS_TABS).toEqual(["checks", "lots"]);
    expect(routes.checks("fr")).toBe("/fr/app/verifications");
    expect(routes.checks("en", "lots")).toBe("/en/app/verifications?tab=lots");
    expect([checksTabOf("lots"), checksTabOf(undefined), checksTabOf("nope"), checksTabOf(["lots"])]).toEqual([
      "lots",
      "checks",
      "checks",
      "lots",
    ]);
  });
});
