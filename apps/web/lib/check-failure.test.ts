import { readFileSync } from "node:fs";

import { DOCX_MIME } from "@verikora/core";
import { describe, expect, it } from "vitest";

import {
  causeOf,
  FAILURE_CAUSES,
  failureOf,
  familyOf,
  FILE_FAMILIES,
  noTextKeyOf,
  RECOVERY,
  retryRequest,
} from "./check-failure";

const messages = (name: string) =>
  JSON.parse(readFileSync(new URL(`../messages/${name}.json`, import.meta.url), "utf8")).console.checkFailure as Record<
    string,
    Record<string, string> | string
  >;
// The engine room's words: a person never reads them (products first: Sovkora appears only as « Powered by »).
const ENGINE_WORDS = /sovkora|engine|moteur|run id|stack ?trace|exception/i;

describe("the credit given back is said in both languages (#3375)", () => {
  it.each(["en", "fr"])("has the sentence, without engine words (%s)", (lang) => {
    const text = messages(lang).creditRestored as string;
    expect(text.length, lang).toBeGreaterThan(10);
    expect(text, lang).not.toMatch(ENGINE_WORDS);
  });
});

describe("a failed check: the cause, in the person's words (krizaka-internal#1900)", () => {
  it.each([
    ["Sovkora finished without a report Verikora can read", "unreadable"],
    ["The run ended failed", "interrupted"],
    ["The run ended cancelled", "interrupted"],
    ["Sovkora refused the document as sent", "refused"],
    [null, "interrupted"],
  ] as const)("%s is %s", (error, cause) => {
    expect(causeOf(error)).toBe(cause);
  });

  it("writes the message for the file's type: a scan is not a text file", () => {
    expect(familyOf({ mimeType: "application/pdf", hasText: false })).toBe("scan");
    expect(familyOf({ mimeType: "application/pdf", hasText: true })).toBe("pdf");
    expect(familyOf({ mimeType: DOCX_MIME, hasText: true })).toBe("office");
    expect(familyOf({ mimeType: "text/plain", hasText: true })).toBe("text");
    expect(familyOf({ mimeType: "image/png", hasText: false })).toBe("other");
  });

  it("never says « no text layer » about a text file", () => {
    for (const lang of ["en", "fr"]) {
      const text = (messages(lang).unreadable as Record<string, string>).text!;
      expect(text, lang).not.toMatch(/text layer|couche de texte|PDF/i);
    }
  });

  it("offers, for every cause, to try again and to choose another file", () => {
    for (const cause of FAILURE_CAUSES) {
      expect(RECOVERY[cause], cause).toEqual(expect.arrayContaining(["retry", "chooseFile"]));
    }
  });

  it.each(["en", "fr"])("has a true message without engine words for every cause x file type (%s)", (lang) => {
    const table = messages(lang);
    for (const cause of FAILURE_CAUSES) {
      for (const family of FILE_FAMILIES) {
        const text = (table[cause] as Record<string, string>)[family];
        expect(text, `${cause}.${family}`).toBeTruthy();
        expect(text, `${cause}.${family}`).not.toMatch(ENGINE_WORDS);
        expect(failureOf("x", { mimeType: "application/pdf", hasText: true }).key).toMatch(/^checkFailure\./);
      }
    }
    for (const word of ["retry", "chooseFile", "title"]) {
      expect(table[word], word).toBeTruthy();
    }
  });
});

describe("the retry runs the same check again", () => {
  it("keeps the Studio and the ruleset it was started with", () => {
    expect(retryRequest({ studio: "document-authenticity", inputs: {} }, "2026-10-31")).toEqual({
      studio: "document-authenticity",
    });
    expect(retryRequest({ studio: "compliance-check", inputs: { ruleset: "qc-invoice" } }, "2026-10-31")).toEqual({
      studio: "compliance-check",
      jurisdiction: "QC",
      asOf: "2026-10-31",
      ruleset: "qc-invoice",
    });
    expect(retryRequest({ studio: "compliance-check", inputs: {} }, "2026-10-31")).not.toHaveProperty("ruleset");
  });
});

describe("the « no text » message names the file's real type", () => {
  it("maps a media type to the message of its family, a closed set, « this file » for the rest", () => {
    expect(noTextKeyOf("application/pdf")).toBe("document.noText.pdf");
    expect(noTextKeyOf("text/plain")).toBe("document.noText.text");
    expect(noTextKeyOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "document.noText.office",
    );
    expect(noTextKeyOf("application/vnd.oasis.opendocument.text")).toBe("document.noText.office");
    expect(noTextKeyOf("image/png")).toBe("document.noText.other");
  });

  it("says PDF only for a PDF, in both languages", () => {
    for (const name of ["fr", "en"]) {
      const file = JSON.parse(readFileSync(new URL(`../messages/${name}.json`, import.meta.url), "utf8"));
      const t = file.console.document.noText as Record<"pdf" | "text" | "office" | "other", string>;
      expect(t.pdf).toMatch(/PDF/);
      for (const k of ["text", "office", "other"] as const) {
        expect(t[k]).not.toMatch(/PDF/);
      }
    }
  });
});
