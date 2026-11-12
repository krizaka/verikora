import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PricingContent } from "@/components/pricing/PricingContent";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { getDictionary } from "@/lib/i18n";
import { isSoldKind } from "@/lib/pricing";

/** krizaka-internal#1901: a signed-in user is shown the grid with « Subscribe », never the public page's « Sign in ». */
const SOLD = [
  { plan: "document", price: "$9.99", per: "dossier" as const, included: null, overage: null },
  { plan: "agency", price: "$49", per: "month" as const, included: 25, overage: "$2" },
];

describe("the in-app plans page", () => {
  it("lives under the app and the home's plan line leads to it", () => {
    expect(CONSOLE_ROUTES.plans).toBe("/app/plans");
  });

  it("a plan of the grid is a kind the checkout sells, an internal one is not", () => {
    expect(isSoldKind("agency")).toBe(true);
    expect(isSoldKind("document")).toBe(true);
    expect(isSoldKind("internal")).toBe(false);
  });

  it("shows the action it is given on every plan, and no « Sign in »", () => {
    const html = renderToStaticMarkup(
      <PricingContent
        locale="en"
        sold={SOLD}
        soon={[]}
        status="In development"
        action={(plan) => <button type="button">{`Subscribe — ${plan}`}</button>}
      />,
    );
    const dict = getDictionary("en");
    expect(html).toContain(`Subscribe — ${"agency"}`);
    expect(html).not.toContain(dict.chrome.signIn);
  });

  it("keeps « Sign in » on the public page", () => {
    const html = renderToStaticMarkup(<PricingContent locale="en" sold={SOLD} soon={[]} status="In development" />);
    expect(html).toContain(getDictionary("en").chrome.signIn);
  });
});
