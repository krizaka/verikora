import { describe, expect, it } from "vitest";

import { CHECKS_TABS, PLATFORMS, SECTION_IDS, SECTIONS, sectionShortcut, sectionsFor } from "./sections";

const ids = (sections: ReturnType<typeof sectionsFor>) => sections.map((s) => s.id);

/** One section map on the web, the phone and the Mac (§ 3.6 of the design direction, yomizaka#319). */
describe("the section map", () => {
  it("is Accueil · Dossiers · Documents · Vérifications (B2, P14), in that order, each with its address; Recherche is ⌘K, not a destination", () => {
    expect(SECTION_IDS).toEqual(["library", "files", "documents", "checks"]);
    expect(SECTIONS.map((s) => s.id)).toEqual(SECTION_IDS);
    expect(Object.fromEntries(SECTIONS.map((s) => [s.id, s.path]))).toEqual({
      library: "/app",
      files: "/app/dossiers",
      documents: "/app/documents",
      checks: "/app/verifications",
    });
    expect(SECTION_IDS as readonly string[]).not.toContain("search");
  });

  it("holds the batches as a tab of Vérifications (« Lots »), on all three platforms", () => {
    expect(CHECKS_TABS).toEqual(["checks", "lots"]);
    for (const platform of PLATFORMS) {
      const checks = sectionsFor(platform).find((s) => s.id === "checks");
      expect(checks?.tabs, platform).toEqual(CHECKS_TABS);
      expect(ids(sectionsFor(platform)), platform).not.toContain("lots");
    }
  });

  it("draws two items on the web, Home and Checks (krizaka-internal#2001): the dossiers and the documents are reached from the home", () => {
    expect(ids(sectionsFor("web"))).toEqual(["library", "checks"]);
    expect(ids(sectionsFor("web", { applicantFiles: true }))).toEqual(["library", "checks"]);
  });

  it("says why a platform lacks a section, instead of a different map (the parity field)", () => {
    expect(ids(sectionsFor("phone", { applicantFiles: true }))).toEqual(["library", "checks"]);
    expect(ids(sectionsFor("mac", { applicantFiles: true }))).toEqual(["library", "checks"]);
    for (const section of SECTIONS)
      for (const reason of Object.values(section.pending)) expect(reason.length, section.id).toBeGreaterThan(20);
    expect(SECTIONS.find((s) => s.id === "library")?.pending).toEqual({});
    expect(SECTIONS.find((s) => s.id === "checks")?.pending).toEqual({});
    expect(SECTIONS.find((s) => s.id === "documents")?.pending).toEqual({
      web: expect.any(String),
      phone: expect.any(String),
      mac: expect.any(String),
    });
  });

  it("numbers the shortcuts by the shown order: ⌘1 to ⌘4", () => {
    expect([0, 1, 2, 3].map(sectionShortcut)).toEqual(["mod+1", "mod+2", "mod+3", "mod+4"]);
    expect(() => sectionShortcut(4)).toThrow();
  });
});
