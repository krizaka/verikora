import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import { groupByFamily, VERDICT_WORDS } from "@/lib/signal-cards";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { AuthenticitySignals, PhotoOriginSignals } from "./AuthenticitySignals";

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const wrap = (node: React.ReactNode, locale: "en" | "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );

// Synthetic: a fictitious stub, nothing from a real document.
const REPORT = {
  header: "Rapport de faits sur le fichier.",
  notExamined: ["Le contenu des images", "Les signatures"],
  signals: [
    {
      signalId: "PDF-REV-002",
      level: "incohérent",
      observation: "Une sauvegarde postérieure a remplacé l'objet qui dessine le montant net.",
      mayIndicate: "Un montant remplacé, ou une correction de l'émetteur.",
      evidence: { page: 2, box: [72, 600, 240, 618] as [number, number, number, number], revision: 2, field: "net" },
    },
    {
      signalId: "PDF-FONT-001",
      level: "inhabituel",
      observation: "Une police n'apparaît que sur une page.",
      evidence: { page: 1 },
    },
    {
      signalId: "CONTENT-PAY-001",
      level: "incohérent",
      observation: "Brut moins retenues ne donne pas le net.",
      askFor: "Demandez le talon tel qu'il est dans le portail de paie.",
    },
    { signalId: "FILE-001", level: "observé", observation: "L'employeur diffère entre le talon et la lettre." },
    { signalId: "PDF-META-001", level: "observé", observation: "Producteur : un éditeur en ligne." },
  ],
};

describe("the traces of editing (ADR-0014, verikora#625)", () => {
  for (const locale of ["en", "fr"] as const) {
    it(`groups by family, shows the evidence, the ordinary explanations, what to ask for and the run, in ${locale}`, () => {
      const html = wrap(<AuthenticitySignals report={REPORT} runId="run_7c1d" />, locale);
      const text = readable(html);
      const t = MESSAGES[locale].console.analysis.traces;
      // families in the report's order: history (REV, META), layout (FONT), figures (CONTENT), across (FILE)
      const order = ["history", "layout", "figures", "across"].map((f) =>
        text.indexOf(t.families[f as keyof typeof t.families]),
      );
      expect(order.every((i) => i >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(text).toContain(t.page.replace("{page}", "2"));
      expect(text).toContain(t.revision.replace("{revision}", "2"));
      expect(text).toContain(t.field.replace("{field}", "net"));
      expect(text).toContain(t.ordinary.history);
      expect(text).toContain(t.askFor.layout); // no engine line: the family's
      expect(text).toContain("Demandez le talon tel qu'il est dans le portail de paie."); // the engine's own line wins
      expect(text).toContain(t.notTitle);
      expect(text).toContain("Le contenu des images, Les signatures");
      expect(text).toContain(t.run.replace("{runId}", "run_7c1d"));
    });

    it(`never says a document is false, never scores, and never paints a level red, in ${locale}`, () => {
      const html = wrap(<AuthenticitySignals report={REPORT} runId="run_7c1d" />, locale);
      expect(html).not.toContain('data-tone="danger"');
      expect(html).toContain('data-tone="warning"');
      expect(readable(html).match(VERDICT_WORDS)).toBeNull();
      const photo = wrap(
        <PhotoOriginSignals
          source={
            {
              kind: "vision",
              by: "sovkora",
              runId: "r",
              model: null,
              localConfidence: 1,
              photos: 1,
              origin: { device: null, software: null, takenAt: null, modifiedAt: null, hadGps: true },
            } as never
          }
        />,
        locale,
      );
      expect(photo).not.toContain('data-tone="danger"');
      expect(readable(photo).match(VERDICT_WORDS)).toBeNull();
    });
  }

  it("adds no total and no count of signals", () => {
    const text = readable(wrap(<AuthenticitySignals report={REPORT} />, "en"));
    expect(text).not.toMatch(/\b\d+ (signals|traces)\b/i);
  });

  it("keeps the engine's order within a family and drops empty families", () => {
    const g = groupByFamily(REPORT.signals);
    expect(g.map((x) => x.family)).toEqual(["history", "layout", "figures", "across"]);
    expect(g[0]?.signals.map((s) => s.signalId)).toEqual(["PDF-REV-002", "PDF-META-001"]);
  });

  it("has a guard that really catches the verdict words, whole words only", () => {
    for (const w of [
      "This was forged",
      "a fake stub",
      "fraud",
      "fraudulent",
      "falsified",
      "counterfeit",
      "risk score",
      "un faux talon",
      "falsifié",
      "frauduleux",
      "contrefait",
      "trafiqué",
      "12 %",
    ]) {
      expect(w).toMatch(VERDICT_WORDS);
    }
    for (const w of ["Page 2", "the platform"]) {
      expect(w).not.toMatch(VERDICT_WORDS);
    }
  });

  it("uses no verdict word in any message of the traces, the levels and the photo origin, EN and FR", () => {
    for (const locale of ["en", "fr"] as const) {
      const { traces, levels, photoOrigin, mayIndicate, where } = MESSAGES[locale].console.analysis;
      const strings: string[] = [];
      const walk = (v: unknown) =>
        typeof v === "string"
          ? strings.push(v)
          : v && typeof v === "object"
            ? Object.values(v).forEach(walk)
            : undefined;
      walk([traces, levels, photoOrigin, mayIndicate, where]);
      expect(strings.length).toBeGreaterThan(40);
      expect(strings.filter((x) => VERDICT_WORDS.test(x))).toEqual([]);
    }
  });
});
