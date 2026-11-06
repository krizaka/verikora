import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/** axe `landmark-unique`: the document tabs' navigation and the file's preview are two landmarks that must not wear the same name (a11y baseline, verikora#462). */
describe("the document page's landmarks", () => {
  it.each([
    ["en", en],
    ["fr", fr],
  ])("the preview region and the tabs' navigation are named differently (%s)", (_locale, messages) => {
    expect(messages.console.document.viewerRegion).not.toBe(messages.console.document.viewer);
  });
  it("the preview is ONE named region: the viewer's own, its wrapper is not a second landmark with the same name (axe landmark-unique, verikora#462)", () => {
    const source = readFileSync(new URL("./DocumentFileTab.tsx", import.meta.url), "utf8");
    expect(source).toContain('region: say("document.viewerRegion")');
    expect(source).not.toContain('aria-label={say("document.viewerRegion")}');
  });
});
