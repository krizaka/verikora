import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { centsOf, RentShare, rentShareSentences } from "./RentShare";

// Guardrail (verikora#557/#559): the share is information, never a verdict, a score, a threshold or a reason to refuse.
const VERDICT_WORDS =
  /\b(approv|accept|refus|reject|declin|reçu|rejet|accepté|approuv|qualif|éligib|eligib|afford|abordable|risk|risqu|score|too high|trop élev|pass|fail|échec|good|bad|bon\b|mauvais)/i;

describe("the rent share on an applicant's file", () => {
  it("reads typed amounts to cents and nothing else", () => {
    expect(centsOf("1 250,50")).toBe(125_050);
    expect(centsOf("1250.5 $")).toBe(125_050);
    expect(centsOf("")).toBeUndefined();
    expect(centsOf("abc")).toBeUndefined();
    expect(centsOf("0")).toBeUndefined();
  });

  it("gives the share as information with the note and the disclaimer, in both languages", () => {
    const e = rentShareSentences("1000", "4000", "en", en.affordability)!;
    expect(e[0]).toBe("The rent is 25% of the income given. Information only.");
    expect(e.join(" ")).toContain("must not be the sole criterion");
    expect(rentShareSentences("1000", "4000", "fr", fr.affordability)!.join(" ")).toContain("pas un avis juridique");
  });

  it("makes no claim without a usable figure, and shows nothing before anything is typed", () => {
    expect(rentShareSentences("", "", "en", en.affordability)).toBeNull();
    expect(rentShareSentences("1000", "", "en", en.affordability)![0]).toBe(en.affordability["no-claim"]);
  });

  it("never speaks like a verdict, at any share", () => {
    for (const [rent, income] of [
      ["500", "9000"],
      ["1000", "4000"],
      ["1500", "2000"],
      ["1500", "1000"],
      ["1000", ""],
    ]) {
      for (const [locale, words] of [
        ["en", en.affordability],
        ["fr", fr.affordability],
      ] as const) {
        expect(rentShareSentences(rent!, income!, locale, words)!.join(" ")).not.toMatch(VERDICT_WORDS);
      }
    }
  });
});

describe("RentShare, as drawn", () => {
  it("shows its two fields and no result until figures are typed, in both languages", () => {
    for (const [locale, messages] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale} messages={messages as never}>
          <RentShare words={messages.affordability} />
        </I18nProvider>,
      );
      expect(html).toContain('data-testid="rent-share"');
      expect(html).toContain('data-rule="TS-A-001"');
      expect(html).toContain(messages.console.dossiers.rentShare.title);
      expect(html).not.toContain(messages.affordability.note);
    }
  });
});
