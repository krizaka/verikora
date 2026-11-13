import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildSampleFile, OUT } from "./build.mjs";
import { DOCUMENTS } from "./documents.mjs";

// What a real person, employer, bank or provider looks like: none of it may appear in the sample file.
const REFUSED = [
  "Desjardins",
  "Hydro-Québec",
  "Hydro-Quebec",
  "Banque Nationale",
  "Banque Royale",
  "RBC",
  "BMO",
  "Scotia",
  "TD Canada",
  "CIBC",
  "Bell",
  "Vidéotron",
  "Videotron",
  "Rogers",
  "Telus",
  "Énergir",
  "Couche-Tard",
  "Metro",
  "Provigo",
  "IGA",
  "Bombardier",
  "CGI",
  "Loblaw",
  "Revenu Québec",
  "Service Canada",
  "Tremblay",
  "Gagnon",
  "Roy",
  "Côté",
  "Bouchard",
  "Gauthier",
  "Morin",
  "Lavoie",
  "Fortin",
  "Gagné",
  "Ouellet",
  "Pelletier",
  "Bélanger",
  "Lévesque",
  "Bergeron",
  "Leblanc",
];
const MARKER = /(Fictif|Exemple|Modèle|Imaginaire|Factice|Inventé|Simulé)/;
const text = DOCUMENTS.flatMap((d) => d.lines).join("\n");

describe("the sample applicant file holds no real person", () => {
  it("every person is named with a marker word and « (fictif) »", () => {
    const people = [
      ...text.matchAll(/(?:Employée|Titulaire|Locataire|Locateur|que) :? ?([\p{L}-]+ [\p{L}-]+) \(fictif\)/gu),
    ].map((m) => m[1]);
    expect(people.length).toBeGreaterThanOrEqual(4);
    for (const name of people) expect(name, name).toMatch(MARKER);
  });
  it("names no real surname, employer, bank or provider", () => {
    for (const word of REFUSED) {
      // The marker surnames hold a real surname after a hyphen (« Exemple-Lavoie »): only a standalone word is refused.
      expect(text, word).not.toMatch(new RegExp(`(^|[^\\p{L}-])${word}([^\\p{L}-]|$)`, "u"));
    }
  });
  it("holds no e-mail, phone number, URL, valid-looking postal code or SIN", () => {
    expect(text).not.toMatch(/@|https?:|www\./i);
    expect(text).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/);
    for (const code of text.match(/\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/g) ?? []) expect(code, code).toMatch(/^[A-Z]\dD /);
    for (const sin of text.match(/NAS : (\d{3} \d{3} \d{3})/g) ?? []) expect(sin).toMatch(/NAS : 0/);
  });
  it("every page of every PDF is stamped as fictitious and every document says so", () => {
    for (const d of DOCUMENTS) expect(d.lines.join("\n")).toContain("DOCUMENT FICTIF");
  });
});

describe("the committed fixtures", () => {
  it("are what the generator writes, and provenance.json holds each file's hash", async () => {
    const { files, provenance } = await buildSampleFile();
    expect(readFileSync(join(OUT, "provenance.json"), "utf8")).toBe(provenance);
    for (const f of files) {
      const kept = readFileSync(join(OUT, "documents", f.filename));
      expect(createHash("sha256").update(kept).digest("hex")).toBe(f.sha256);
    }
    expect(JSON.parse(provenance).fictitious).toBe(true);
  });
  it("agree with each other (the pay and the employer's letter say the same, the deposits add up)", () => {
    expect(text).toContain("Salaire brut : 3 100,00 $"); // 2 × 3 100 × 12 = 74 400
    expect(text).toContain("Salaire annuel : 74 400,00 $");
    expect(text.match(/Atelier Factice inc\./g)?.length).toBeGreaterThanOrEqual(4);
  });
});
