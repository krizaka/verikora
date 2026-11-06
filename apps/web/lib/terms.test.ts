import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { TERMS_VERSION } from "./signup";

const text = (d: typeof fr) => d.terms.sections.map((s) => `${s.h} ${s.p}`).join("\n");

describe("the terms of use (verikora#439)", () => {
  it("has the same sections in French (the reference) and in English", () => {
    expect(fr.terms.sections).toHaveLength(en.terms.sections.length);
    for (const s of [...fr.terms.sections, ...en.terms.sections]) {
      expect(s.h.length).toBeGreaterThan(3);
      expect(s.p.length).toBeGreaterThan(80);
    }
  });

  it("reserves Krizaka's rights: IP, a licence limited to the subscription, no resale or white label, marks", () => {
    const french = text(fr);
    for (const needle of [
      "appartiennent à Technologies Krizaka Inc.",
      "Pour la durée de votre abonnement seulement",
      "non cessible et non sous-licenciable",
      "marque blanche",
      "service concurrent",
      "Loi sur le droit d’auteur",
      "Loi sur les marques de commerce",
      "TRADEMARKS.md",
      "sa propre licence",
      "décompiler",
    ]) {
      expect(french, needle).toContain(needle);
    }
    const english = text(en);
    for (const needle of [
      "belong to Technologies Krizaka Inc.",
      "For the length of your subscription only",
      "non-transferable, non-sublicensable",
      "white label",
      "competing service",
      "Copyright Act",
      "Trademarks Act",
      "TRADEMARKS.md",
      "its own licence",
      "decompile",
    ]) {
      expect(english, needle).toContain(needle);
    }
  });

  it("limits liability with the law cited, and names Québec law and the courts of Montréal", () => {
    const french = text(fr);
    for (const needle of [
      "Limitation de responsabilité",
      "art. 1474 C.c.Q.",
      "articles 1435 à 1437 C.c.Q.",
      "art. 10 de la Loi sur la protection du consommateur",
      "lois du Québec",
      "district judiciaire de Montréal",
      "art. 3149 C.c.Q.",
      "art. 33 du Code de procédure civile",
      "Charte de la langue française",
    ]) {
      expect(french, needle).toContain(needle);
    }
    const english = text(en);
    for (const needle of [
      "Limitation of liability",
      "art. 1474 C.c.Q.",
      "arts. 1435 to 1437 C.c.Q.",
      "laws of Québec",
      "judicial district of Montréal",
      "art. 3149 C.c.Q.",
      "French prevails",
    ]) {
      expect(english, needle).toContain(needle);
    }
  });

  it("says the text awaits the lawyer and never claims it was reviewed", () => {
    expect(fr.terms.status).toContain("en attente de relecture par l’avocat");
    expect(en.terms.status).toContain("awaiting review by the lawyer");
    expect(`${text(fr)} ${text(en)}`).not.toMatch(/relu par|revu par|reviewed by (a|the) lawyer/i);
    expect(readFileSync(new URL("../app/[locale]/terms/page.tsx", import.meta.url), "utf8")).toContain(
      'data-lawyer-review="pending"',
    );
  });

  it("keeps the code licence out of the reverse-engineering clause: only what is not published", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
    const clause = (d: typeof fr, h: RegExp) => d.terms.sections.find((s) => h.test(s.h))?.p ?? "";
    expect(clause(fr, /^Usages interdits/)).toContain("qui ne sont pas publiées");
    expect(clause(en, /^Prohibited uses/)).toContain("that are not published");
  });
});
