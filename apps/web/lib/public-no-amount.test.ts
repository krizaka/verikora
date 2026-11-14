import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Org rule `public-no-amount` (founder 2026-11-03): no money amount in public words, no « à partir de », no « sur devis ».
// The one allowed price is Verikora's single-file price, approved by the founder on 2026-11-12: it is data read from the
// price catalogue at render time (never typed in a message), so a catalogue entry holds it and a public sentence only
// carries a placeholder such as {offer}, {regular} or {price}.
const MESSAGES = join(__dirname, "..", "messages");
const PUBLIC = ["site", "legal", "marketing"];
const AMOUNT = /(\d[\d\s.,]*\s?(\$|€|£|CAD|USD|EUR|dollars?)|(\$|€|£)\s?\d)/i;
// « à partir de » alone is ordinary French (« à partir de la loi »): it is price wording only before a figure or a placeholder.
const PRICE_WORDING = /à partir de\s+(\d|\{|un prix)|sur devis|starting (at|from)\s+(\d|\{|\$)|quote on request/i;

const strings = (value: unknown, path = ""): [string, string][] =>
  typeof value === "string"
    ? [[path, value]]
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`))
      : [];

const publicWords = PUBLIC.flatMap((dir) =>
  readdirSync(join(MESSAGES, dir))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => strings(JSON.parse(readFileSync(join(MESSAGES, dir, f), "utf8"))).map(([p, v]) => [`${dir}/${f}${p}`, v] as const)),
);

describe("no money amount in the public words", () => {
  it("reads the public catalogues", () => {
    expect(publicWords.length).toBeGreaterThan(50);
  });

  it("holds no typed amount or currency: the price is the catalogue's, shown through a placeholder", () => {
    expect(publicWords.filter(([, v]) => AMOUNT.test(v)).map(([p]) => p)).toEqual([]);
  });

  it("holds no « from » or « on request » price wording", () => {
    expect(publicWords.filter(([, v]) => PRICE_WORDING.test(v)).map(([p]) => p)).toEqual([]);
  });
});
