import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { ApplicantFilesNotOffered } from "./ApplicantFilesNotOffered";

/** krizaka-internal#2289: a person who is not offered the applicant files reads why and how to change it, never a 404. */
describe("the page of a person not offered the applicant files", () => {
  it("says in French that the applicant files are for property managers and links the profile setting, with no bird", () => {
    const html = renderToStaticMarkup(<ApplicantFilesNotOffered locale="fr" />);
    expect(html).toContain("Les dossiers de candidats sont pour les gestionnaires");
    expect(html).toMatch(/<a [^>]*href="\/fr\/app\/settings\/profil"[^>]*>Changer de rôle<\/a>/);
    expect(html).not.toMatch(/<svg|<img/);
  });

  it("says it in English too", () => {
    const html = renderToStaticMarkup(<ApplicantFilesNotOffered locale="en" />);
    expect(html).toContain("Applicant files are for property managers");
    expect(html).toMatch(/<a [^>]*href="\/en\/app\/settings\/profil"[^>]*>Change role<\/a>/);
  });

  it("is one short line of explanation in both languages", () => {
    for (const messages of [en, fr]) {
      expect(messages.console.dossiers.notOffered.text.length).toBeLessThan(120);
    }
  });
});

describe("the three pages of the applicant files never answer 404 to a person who is not offered them", () => {
  const read = (path: string) => readFileSync(new URL(`../../app/[locale]/(app)/app/${path}`, import.meta.url), "utf8");
  it.each(["dossiers/page.tsx", "dossiers/[id]/page.tsx", "screening/page.tsx"])("%s explains instead", (path) => {
    const source = read(path);
    expect(source).toContain("ApplicantFilesNotOffered");
    expect(source).not.toMatch(/applicantFilesOffered\([^\n]*\)\)\s*notFound\(\)/);
    expect(source).not.toMatch(/FLOW_NOT_OFFERED"\)\s*notFound\(\)/);
  });
});
