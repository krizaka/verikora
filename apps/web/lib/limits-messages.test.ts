import { describe, expect, it } from "vitest";

import en from "../messages/console/en.json";
import fr from "../messages/console/fr.json";
import { LIMIT_SETTINGS } from "./settings/limits";

/** The administrator reads a label and a hint for every setting: each `limits.<action>.*` has both, in both languages. */
describe("the limit settings in the console", () => {
  for (const [name, catalogue] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`are labelled in ${name}`, () => {
      const settings = catalogue.console.adminConfig.settings as unknown as Record<string, unknown>;
      for (const key of Object.keys(LIMIT_SETTINGS)) {
        const entry = key
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], settings) as
          { label?: string; hint?: string } | undefined;
        expect(entry?.label, key).toBeTruthy();
        expect(entry?.hint, key).toBeTruthy();
      }
    });
  }
});
