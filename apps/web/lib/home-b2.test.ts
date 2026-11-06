import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { binderOf, creditsFigure, homeHref, leadParts, quickLinks, stripOf, weekOf } from "./home-b2";
import type { ActivityDay } from "./home-figures";

/** The B2 home's pure pieces (verikora#332): the sentence, the binder, the strip, the week and the credits. */
const MESSAGES = { en: en.console, fr: fr.console } as const;
const translator =
  (locale: "en" | "fr") =>
  (key: string, vars: Record<string, string | number> = {}) => {
    const found = key
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], MESSAGES[locale]);
    if (typeof found !== "string") {
      throw new Error(`missing message ${key}`);
    }
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), found);
  };
const sentence = (todo: Parameters<typeof leadParts>[0], locale: "en" | "fr") =>
  leadParts(todo, locale, translator(locale))
    .map((p) => p.text)
    .join("");

describe("the sentence under the heading: figures that are links, plurals right at 0, 1 and many", () => {
  it("English, one of each: singular nouns", () => {
    expect(sentence({ toReview: 1, toDecide: 1, openLinks: 1 }, "en")).toBe(
      "You have 1 check to look at, 1 file to decide, and 1 open upload link.",
    );
  });
  it("English, many", () => {
    expect(sentence({ toReview: 6, toDecide: 2, openLinks: 3 }, "en")).toBe(
      "You have 6 checks to look at, 2 files to decide, and 3 open upload links.",
    );
  });
  it("French, one and many", () => {
    expect(sentence({ toReview: 1, toDecide: 2, openLinks: 1 }, "fr")).toBe(
      "Vous avez 1 vérification à regarder, 2 dossiers à décider et 1 lien de dépôt ouvert.",
    );
  });
  it("skips a figure at zero or absent (no applicant-file flow) and says it plainly when all are zero", () => {
    expect(sentence({ toReview: 0, toDecide: 2, openLinks: 0 }, "en")).toBe("You have 2 files to decide.");
    expect(sentence({ toReview: 3, toDecide: null, openLinks: null }, "en")).toBe("You have 3 checks to look at.");
    expect(sentence({ toReview: 0, toDecide: 0, openLinks: 0 }, "en")).toBe(en.console.home.todo.nothing);
    expect(sentence({ toReview: 0, toDecide: null, openLinks: null }, "fr")).toBe(fr.console.home.todo.nothing);
  });
  it("each figure is a link to the view it counts, in the address's language; the words around are not", () => {
    const parts = leadParts({ toReview: 6, toDecide: 2, openLinks: 1 }, "fr", translator("fr"));
    const links = parts.filter((p) => p.href);
    expect(links.map((l) => l.href)).toEqual([
      "/fr/app/verifications?result=attention%2Cfailed",
      "/fr/app/dossiers?state=used",
      "/fr/app/dossiers?state=open",
    ]);
    expect(links.map((l) => l.text)).toEqual([
      "6 vérifications à regarder",
      "2 dossiers à décider",
      "1 lien de dépôt ouvert",
    ]);
    expect(parts.filter((p) => !p.href).every((p) => !/\d/.test(p.text))).toBe(true);
  });
});

describe("« Le classeur »: the collections as tabs with their counts", () => {
  const c = (
    id: string,
    files: number,
    last: "checked" | "attention" | "failed" | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    name: id,
    files,
    isDefault: false,
    lastCheck: last ? { at: "2026-10-20T10:00:00Z", status: last } : null,
    ...extra,
  });
  const href = (id: string) => `/fr/app?collection=${id}`;
  it("one tab per collection with its file count and the address that opens it; the colour follows the last check, and the words always say it", () => {
    const { tabs } = binderOf(
      [c("a", 3, "attention"), c("b", 0, null), c("c", 5, "checked"), c("d", 1, "failed")],
      "b",
      href,
    );
    expect(tabs.map((t) => [t.id, t.count, t.hue, t.href])).toEqual([
      ["a", 3, "warning", "/fr/app?collection=a"],
      ["b", 0, "neutral", "/fr/app?collection=b"],
      ["c", 5, "success", "/fr/app?collection=c"],
      ["d", 1, "danger", "/fr/app?collection=d"],
    ]);
  });
  it("the address chooses the selected tab; without it (or with a stale one) the default collection, else the first", () => {
    const list = [c("a", 1, null), c("b", 2, null, { isDefault: true })];
    expect(binderOf(list, "a", href).selected?.id).toBe("a");
    expect(binderOf(list, null, href).selected?.id).toBe("b");
    expect(binderOf(list, "gone", href).selected?.id).toBe("b");
    expect(binderOf([c("x", 1, null)], null, href).selected?.id).toBe("x");
    expect(binderOf([], null, href)).toEqual({ tabs: [], selected: null });
  });
  it("marks exactly one tab active", () => {
    const { tabs } = binderOf([c("a", 1, null), c("b", 2, null)], "b", href);
    expect(tabs.filter((t) => t.active).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("the activity strip: four figures, each the sum of its own series over the period", () => {
  const days = (counts: number[]): ActivityDay[] =>
    counts.map((checks, i) => ({ day: `2026-10-${String(10 + i).padStart(2, "0")}`, checks }));
  it("totals each series and keeps its values for the sparkline, oldest first", () => {
    const strip = stripOf({
      checks: days([1, 0, 4]),
      toReview: days([0, 0, 2]),
      documents: days([2, 2, 2]),
      files: days([0, 1, 0]),
    });
    expect(strip.map((f) => [f.id, f.total, f.values])).toEqual([
      ["checks", 5, [1, 0, 4]],
      ["toReview", 2, [0, 0, 2]],
      ["documents", 6, [2, 2, 2]],
      ["files", 1, [0, 1, 0]],
    ]);
  });
  it("leaves out the files figure without the applicant-file flow", () => {
    expect(
      stripOf({ checks: days([1]), toReview: days([0]), documents: days([1]), files: null }).map((f) => f.id),
    ).toEqual(["checks", "toReview", "documents"]);
  });
});

describe("the week chart: the last seven days of the period, whatever its length", () => {
  it("takes the last seven days of a 30-day period, and all of a 7-day one", () => {
    const thirty: ActivityDay[] = Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, checks: i }));
    expect(weekOf(thirty).map((d) => d.checks)).toEqual([23, 24, 25, 26, 27, 28, 29]);
    expect(weekOf(thirty.slice(-7))).toHaveLength(7);
  });
});

describe("the credits: what the account has, said as the billing state says it", () => {
  const e = (patch: Partial<Parameters<typeof creditsFigure>[0]> = {}) => ({
    selfServe: true,
    freeAuditUsed: true,
    credits: 0,
    pro: false,
    proUntil: null,
    cancelsAtPeriodEnd: false,
    subscriptionStatus: null,
    hasCustomer: false,
    customerId: null,
    planKey: null,
    priceVersionId: null,
    ...patch,
  });
  it("an account made by an operator (demo, QA) has its audits included, with no meter", () => {
    expect(creditsFigure(e({ selfServe: false }), 4, 100)).toEqual({ kind: "included" });
  });
  it("Pro: audits used this month against the fair-use cap, and when it renews", () => {
    expect(creditsFigure(e({ pro: true, proUntil: "2026-11-20T00:00:00.000Z" }), 12, 100)).toEqual({
      kind: "pro",
      used: 12,
      cap: 100,
      renewsAt: "2026-11-20T00:00:00.000Z",
      cancelled: false,
    });
  });
  it("Pro cancelled at period end: the same date, said as the end", () => {
    expect(
      creditsFigure(e({ pro: true, proUntil: "2026-11-20T00:00:00.000Z", cancelsAtPeriodEnd: true }), 3, 100),
    ).toEqual({ kind: "pro", used: 3, cap: 100, renewsAt: "2026-11-20T00:00:00.000Z", cancelled: true });
  });
  it("otherwise the audits left: the credits, plus the free audit while it is unspent", () => {
    expect(creditsFigure(e({ credits: 3 }), 0, 100)).toEqual({ kind: "credits", left: 3 });
    expect(creditsFigure(e({ credits: 3, freeAuditUsed: false }), 0, 100)).toEqual({ kind: "credits", left: 4 });
    expect(creditsFigure(e(), 0, 100)).toEqual({ kind: "credits", left: 0 });
  });
});

describe("the quick access: where the person goes most, besides the header's one action", () => {
  it("offers the request for documents (with the applicant-file flow), the documents, the checks and the search", () => {
    expect(quickLinks("fr", true).map((q) => [q.id, q.href])).toEqual([
      ["request", "/fr/app/dossiers"],
      ["documents", "/fr/app/documents"],
      ["checks", "/fr/app/verifications"],
      ["search", "/fr/app/search"],
    ]);
  });
  it("is the other three without the flow — never a tile that leads nowhere — and never repeats « Vérifier un document »", () => {
    expect(quickLinks("en", false).map((q) => q.id)).toEqual(["documents", "checks", "search"]);
    expect(quickLinks("en", true).some((q) => q.href.endsWith("/app/check"))).toBe(false);
  });
});

describe("the home's address holds its state: the period, and the open tab of the binder", () => {
  it("names the period always, the collection once chosen, and each keeps the other", () => {
    expect(homeHref("fr", { period: "30d" })).toBe("/fr/app?period=30d");
    expect(homeHref("en", { period: "7d", collection: "c1" })).toBe("/en/app?period=7d&collection=c1");
    expect(homeHref("fr", { period: "90d", collection: null })).toBe("/fr/app?period=90d");
  });
});
