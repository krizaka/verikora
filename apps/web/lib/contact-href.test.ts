import { describe, expect, it } from "vitest";

import { contactHref } from "./site";

describe("contactHref: the one builder of Krizaka's contact form link (final, localized address: no redirect hop for crawlers)", () => {
  it("is localized and carries the kind (topic), the product and the source: support by default", () => {
    expect(contactHref("verikora-footer", "fr")).toBe(
      "https://www.krizaka.com/fr/contact?topic=support&product=verikora&source=verikora-footer",
    );
    expect(contactHref("verikora-contact", "en")).toBe(
      "https://www.krizaka.com/en/contact?topic=support&product=verikora&source=verikora-contact",
    );
  });

  it("takes another kind (a volume request is business)", () => {
    expect(contactHref("verikora-pricing", "en", "business")).toBe(
      "https://www.krizaka.com/en/contact?topic=business&product=verikora&source=verikora-pricing",
    );
  });
});
