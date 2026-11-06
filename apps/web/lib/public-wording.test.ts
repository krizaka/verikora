import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/** Verikora reads documents; it is no identity verifier, no legal rule engine, no escrow (krizaka/verikora#371). */
const FORBIDDEN = /vérification d['’]identité|identity verification|règles juridiques|legal rules|séquestre|escrow/i;

const strings = (value: unknown, path = ""): string[] =>
  typeof value === "string"
    ? [`${path} = ${value}`]
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
      : [];

describe.each([
  ["en", en],
  ["fr", fr],
])("the %s messages", (_locale, messages) => {
  it("keep clear of the forbidden public wording", () => {
    expect(strings(messages).filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });
});
