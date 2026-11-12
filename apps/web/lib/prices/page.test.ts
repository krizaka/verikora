import {
  AVAILABILITY,
  memoryPriceStore,
  type PriceCatalogue,
  priceCatalogue,
  publicCatalogue,
} from "@krizaka/settings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PricingContent } from "@/components/pricing/PricingContent";

import { PRICE, PRICES } from "../pricing";
import { pricingLines } from "./page";

const NOW = new Date("2026-10-26T12:00:00Z");
const ADMIN = { id: null, label: "admin@verikora.test" };
const nb = (s: string | null) => s?.replaceAll(/\s/gu, " ") ?? null;
/** The text of an HTML fragment: what sits between a `>` and the next `<`, without entities. No tag is stripped by pattern. */
const textOf = (html: string) =>
  [...`>${html}<`.matchAll(/>([^<>]*)</g)].map((m) => m[1]!.replaceAll(/&#x?[0-9a-f]+;/gi, "")).join("");
const fresh = () => priceCatalogue(PRICES, memoryPriceStore());
const linesOf = async (c: PriceCatalogue, locale: "en" | "fr") =>
  pricingLines(publicCatalogue(await c.catalogue(NOW)), locale);
const render = async (c: PriceCatalogue, locale: "en" | "fr", freeFirst = true) => {
  const { sold, soon } = await linesOf(c, locale);
  return renderToStaticMarkup(PricingContent({ locale, sold, soon, freeFirst, status: "In development" }));
};

describe("the pricing page reads the catalogue (#388)", () => {
  it("sells one file only (9,99 $ / $9.99), and shows the two subscriptions as soon, with no amount (founder, 2026-11-12)", async () => {
    const lines = await linesOf(fresh(), "fr");
    expect(lines.sold.map((l) => [l.plan, nb(l.price), l.per, l.included])).toEqual([
      ["document", "9,99 $", "dossier", null],
    ]);
    expect((await linesOf(fresh(), "en")).sold.map((l) => l.price)).toEqual(["$9.99"]);
    expect(lines.soon).toEqual([
      { plan: "agency" },
      { plan: "firm" },
      { plan: "fullFile" },
      { plan: "backgroundCheck" },
      { plan: "screening" },
    ]);
  });

  it("the page names the subscriptions as soon and shows no subscription price, no volume line, no overage rate", async () => {
    for (const locale of ["en", "fr"] as const) {
      const html = nb(await render(fresh(), locale))!;
      expect(html).toContain('data-soon="agency"');
      expect(html).toContain('data-soon="firm"');
      expect(html).not.toMatch(/(?<!\d)(49|149)[,.]00/u);
      expect(html).not.toContain("data-volume");
      expect(html).not.toMatch(/Then \$3|Puis 3,00/u);
    }
  });

  it("says the rate of a dossier past the volume, per dossier, from the catalogue, for a subscription put on sale (#44, ADR-0015)", async () => {
    const c = fresh();
    for (const k of [PRICE.agency, PRICE.firm]) {
      await c.schedule(ADMIN, k, { availability: AVAILABILITY.public }, NOW, NOW);
    }
    const lines = await linesOf(c, "en");
    expect(lines.sold.map((l) => [l.plan, l.overage])).toEqual([
      ["document", null],
      ["agency", "$3.00"],
      ["firm", "$2.00"],
    ]);
    const html = nb(await render(c, "en"));
    expect(html).toContain("Then $3.00 for each further dossier");
    expect(html).toContain("15 dossiers included each month");
    expect(html).toContain("per dossier, plus taxes");
    expect(nb(await render(c, "fr"))).toContain("Puis 3,00 $ par dossier supplémentaire");
  });

  it("never shows the internal entry", async () => {
    const lines = await linesOf(fresh(), "en");
    expect([...lines.sold, ...lines.soon].map((l) => l.plan)).not.toContain("api");
  });

  it("changing a price in the catalogue changes the page", async () => {
    const c = fresh();
    const before = nb(await render(c, "fr"));
    expect(before).toContain("9,99 $");
    await c.schedule(ADMIN, PRICE.document, { amountCents: 1199 }, NOW, NOW);
    const after = nb(await render(c, "fr"));
    expect(after).toContain("11,99 $");
    expect(after).not.toContain("9,99 $");
  });

  it("above the largest included volume, a line leads to the contact form, with the catalogue's figure and no price (#360)", async () => {
    const c = fresh();
    for (const k of [PRICE.agency, PRICE.firm]) {
      await c.schedule(ADMIN, k, { availability: AVAILABILITY.public }, NOW, NOW);
    }
    const volume = (html: string) => /<p data-volume[^>]*><a href="([^"]+)">([^<]+)<\/a><\/p>/.exec(html);
    const fr = volume(nb(await render(c, "fr"))!)!;
    expect(fr[1]).toContain("/contact?topic=business&amp;product=verikora&amp;source=verikora-pricing");
    expect(fr[2]).toBe("Plus de 60 dossiers par mois ? Écrivez-nous");
    expect(volume(nb(await render(c, "en"))!)![2]).toBe("More than 60 dossiers a month? Write to us");
    await c.schedule(ADMIN, PRICE.firm, { limits: { included: 600 } }, NOW, NOW);
    expect(volume(nb(await render(c, "en"))!)![2]).toContain("600");
  });

  it("follows an entry the administrator took off sale: it leaves the plans, and appears as soon without a figure", async () => {
    const c = fresh();
    await c.schedule(ADMIN, PRICE.document, { availability: AVAILABILITY.preparing }, NOW, NOW);
    const lines = await linesOf(c, "fr");
    expect(lines.sold.map((l) => l.plan)).not.toContain("document");
    expect(lines.soon.map((l) => l.plan)).toContain("document");
  });

  it("a « soon » line carries no number, in both languages", async () => {
    for (const locale of ["en", "fr"] as const) {
      const html = await render(fresh(), locale);
      const soonLines = [...html.matchAll(/<li[^>]*data-soon="[^"]+"[^>]*>(.*?)<\/li>/g)].map((m) => textOf(m[1]!));
      expect(soonLines).toHaveLength(5);
      for (const line of soonLines) expect(line, line).not.toMatch(/\d/);
    }
  });

  it("the call to action is « request access » (the contact page), never « Start now » nor « Sign in »: sign-up is closed while the product is in development", async () => {
    for (const locale of ["en", "fr"] as const) {
      const html = await render(fresh(), locale);
      expect(html).toContain(`href="/${locale}/contact"`);
      expect(html).not.toContain(`href="/${locale}/sign-in"`);
      expect(html).not.toMatch(/Start now|Commencer maintenant|Essai gratuit|Free trial/i);
      expect(html).toContain("In development");
    }
  });

  it("the in-app plans page offers a call to action for the file only: the subscriptions are « soon », with no button", async () => {
    const { sold, soon } = await linesOf(fresh(), "fr");
    const offered: string[] = [];
    const html = renderToStaticMarkup(
      PricingContent({
        locale: "fr",
        sold,
        soon,
        freeFirst: true,
        status: "",
        action: (plan) => {
          offered.push(plan);
          return "S’abonner";
        },
      }),
    );
    expect(offered).toEqual(["document"]);
    expect(html.match(/S’abonner|S&#x27;abonner/g)).toHaveLength(1);
  });

  it("the free monthly dossier is shown only while the setting says so", async () => {
    expect(await render(fresh(), "en", true)).toContain("One dossier verified free every month");
    expect(await render(fresh(), "en", false)).not.toContain("One dossier verified free every month");
  });
});
