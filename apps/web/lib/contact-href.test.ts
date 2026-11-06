import { describe, expect, it } from "vitest";

import { contactHref } from "./site";

describe("contactHref: the final address (a redirect hop is a Search Console « page with redirect »)", () => {
  it("is localized and carries the topic and source", () => {
    expect(contactHref("dev-verikora-footer", "fr")).toBe(
      "https://www.krizaka.com/fr/contact?topic=verikora&source=dev-verikora-footer",
    );
    expect(contactHref("x", "en")).toMatch(/^https:\/\/www\.krizaka\.com\/en\/contact\?topic=verikora&/);
  });
});
