import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { storageCards } from "./cards";

// The bug this guards: the `cloud` mode appeared as a card showing its raw message keys (« console.settings.storage.cloud »).
describe("the storage cards", () => {
  it("never offer the cloud mode as a card, it has its own panel", () => {
    expect(storageCards(true)).not.toContain("cloud");
    expect(storageCards(false)).toEqual(["none", "krizaka"]);
  });
  it("every card has its title and hint in both languages", () => {
    for (const messages of [en, fr]) {
      const storage = (messages as unknown as { console: { settings: { storage: Record<string, unknown> } } }).console.settings.storage;
      for (const mode of storageCards(true)) {
        expect(typeof storage[mode], `${mode}`).toBe("string");
        expect(typeof storage[`${mode}Hint`], `${mode}Hint`).toBe("string");
      }
    }
  });
});
