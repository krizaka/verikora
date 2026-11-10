import { KrizakaQueryProvider } from "@krizaka/query";
import { DOCUMENT_KINDS, offerOf } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { catalogueOf } from "@/lib/check-catalogue";
import { SEED_FLOWS } from "@/lib/flows-seed";
import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { CheckQueue, CheckView, FlowSteps, KindQuestion } from "./CheckView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/check",
  useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:'|&#x27;)");
const wrap = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>{node}</KrizakaQueryProvider>
    </I18nProvider>,
  );
const render = (locale: "en" | "fr" = "fr") => wrap(<CheckView />, locale);

describe("« Vérifier un document » (the UX review's Y4)", () => {
  it("has one h1 and the drop zone; the kind is not asked before a drop, Verikora recognises it from the file (verikora#318)", () => {
    const html = render();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.indexOf(fr.console.library.dropTitle)).toBeGreaterThan(0);
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain('data-testid="kind-choice"');
    expect(readable(html)).not.toContain(fr.console.library.kindPick);
  });

  it("names the defaults before the drop, with « Modifier » (Errata 6, verikora#326), and says the check is informative", () => {
    const html = render();
    const defaults = html.indexOf('data-testid="check-defaults"');
    expect(defaults).toBeGreaterThan(0);
    // Before the drop zone (its title after the page's h1; the section's own label carries it too).
    expect(defaults).toBeLessThan(html.indexOf(fr.console.library.dropTitle, html.indexOf("</h1>")));
    const text = readable(html);
    for (const key of ["erased", "rules", "place", "modify"] as const)
      expect(text).toContain(fr.console.check.defaults[key]);
    expect(html).toContain('data-testid="keep-choice"');
    // « Ces photos sont les pages d'un document » only once photos are known (the review's C3).
    expect(html).not.toContain('data-testid="group-photos"');
    expect(readable(html)).toContain(fr.console.library.informative);
    expect(readable(render("en"))).toContain(en.console.library.informative);
  });
});

describe("the kind picker, asked only when the kind is uncertain (verikora#318, P1 of the design direction)", () => {
  for (const locale of ["fr", "en"] as const) {
    const m = MESSAGES[locale].console;
    it(`asks « ${m.library.kindPick} » for that file as a labelled radiogroup of cards, each kind's title and hint as separate text (${locale})`, () => {
      const html = wrap(<KindQuestion filename="scan-0042.pdf" onPick={() => {}} />, locale);
      const group = html.match(/<[^>]+role="radiogroup"[^>]*>/)?.[0] ?? "";
      expect(group, "a radiogroup").not.toBe("");
      const labelledBy = group.match(/aria-labelledby="([^"]+)"/)?.[1];
      expect(labelledBy, "labelled by the visible question").toBeTruthy();
      expect(html).toMatch(new RegExp(`id="${escape(labelledBy!)}"[^>]*>(?:<[^>]+>)*${escape(m.library.kindPick)}<`));
      for (const kind of DOCUMENT_KINDS) {
        // The title and the hint are two elements, never « BailLoyer, durée… » glued in one text node.
        expect(html).toMatch(new RegExp(`>${escape(m.kinds[kind])}</span>`));
        expect(html).toMatch(new RegExp(`<span id="[^"]+"[^>]*>${escape(m.library.kindHints[kind])}</span>`));
      }
      expect(readable(html)).not.toContain(m.kinds.auto);
      expect(readable(html)).toContain(m.library.kindUnsure.replace("{name}", "scan-0042.pdf"));
      expect(html).toContain('data-testid="kind-choice"');
    });
  }
});

describe("the queue: one row per file, its stage in words (verikora#326, P9)", () => {
  const row = (id: string, stage: string, refused: string | null = null) =>
    ({ id, filename: `${id}.pdf`, stage, refused }) as never;
  const queue = (rows: never[], locale: "en" | "fr" = "fr") =>
    wrap(<CheckQueue rows={rows} onPick={() => {}} />, locale);

  it("says every stage in words — progress is never a bare bar, so reduced motion keeps it", () => {
    for (const locale of ["fr", "en"] as const) {
      const m = MESSAGES[locale].console.check.stages;
      const text = readable(
        queue([row("a", "reading"), row("b", "starting"), row("c", "started"), row("d", "refused", "PAYWALL")], locale),
      );
      expect(text).toContain(m.reading);
      expect(text).toContain(m.starting);
      expect(text).toContain(m.started);
      expect(text).toContain(m.refused.replace("{reason}", MESSAGES[locale].console.errors.PAYWALL));
    }
  });

  it("asks « Quel document ? » for each uncertain file, its own labelled question, and no other", () => {
    const html = queue([row("a", "asking"), row("b", "started"), row("c", "asking")]);
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(readable(html)).toContain(fr.console.library.kindUnsure.replace("{name}", "a.pdf"));
    expect(readable(html)).toContain(fr.console.library.kindUnsure.replace("{name}", "c.pdf"));
    expect(readable(html)).not.toContain(fr.console.library.kindUnsure.replace("{name}", "b.pdf"));
  });

  it("leaves the question to the page when asked to: the queue lists the row without its own radiogroup", () => {
    const html = wrap(<CheckQueue rows={[row("a", "asking")] as never} onPick={() => undefined} questions={false} />);
    expect(html).not.toContain('role="radiogroup"');
    expect(readable(html)).toContain("a.pdf");
  });

  it("draws the flow in four steps, the current one marked, in both languages (krizaka-internal#1899)", () => {
    for (const locale of ["fr", "en"] as const) {
      const m = MESSAGES[locale].console.check.flow;
      const html = wrap(<FlowSteps rows={[row("a", "asking")] as never} />, locale);
      const text = readable(html);
      for (const label of [m.drop, m.kind, m.running, m.result]) {
        expect(text).toContain(label);
      }
      expect(html).toContain('data-testid="check-flow"');
    }
    expect(render()).toContain('data-testid="check-flow"');
  });

  it("links a row that is under way, or refused, to its report", () => {
    const html = queue([row("a", "started"), row("b", "refused", "PAYWALL"), row("c", "reading")]);
    expect(html).toContain('href="/fr/app/documents/a/rapport"');
    expect(html).toContain('href="/fr/app/documents/b/rapport?refused=PAYWALL"');
    expect(html).not.toContain('href="/fr/app/documents/c/rapport"');
  });
});

const tenant = catalogueOf(
  offerOf(SEED_FLOWS.filter((f) => f.definition.audiences.includes("tenant")).map((f) => f.definition)),
);
const withCatalogue = (props: Partial<Parameters<typeof CheckView>[0]> = {}, locale: "en" | "fr" = "fr") =>
  wrap(
    <CheckView
      catalogue={tenant}
      credits={{ kind: "pro", used: 18, cap: 100, renewsAt: null, cancelled: false }}
      {...props}
    />,
    locale,
  );

describe("« Vérifier un document », B2: the plan strip, the catalogue, the drop and the run (verikora#333)", () => {
  it("shows where the account stands: its plan and its audits from the billing state, as a muted line at the foot", () => {
    const html = withCatalogue();
    const stripStart = html.indexOf('data-testid="plan-strip"');
    const stripHtml = html.slice(stripStart, html.indexOf("</p>", stripStart) + 4);
    const text = readable(stripHtml);
    expect(text).toContain(fr.console.check.plan.names.pro);
    expect(text).toContain("18 sur 100");
    expect(stripHtml).toContain('href="/fr/app/settings/facturation"');
  });

  it("credits: the audits left shown in the strip; an account an operator made says its audits are included", () => {
    const credits = withCatalogue({ credits: { kind: "credits", left: 3 } });
    const stripStart = credits.indexOf('data-testid="plan-strip"');
    const stripHtml = credits.slice(stripStart, credits.indexOf("</p>", stripStart) + 4);
    expect(readable(stripHtml)).toMatch(/\b3\b/);
    expect(readable(withCatalogue({ credits: { kind: "included" } }))).toContain(fr.console.check.plan.names.included);
  });

  it("lists the checks that run, each with « Disponible » and one action that names its kind and leads to the drop", () => {
    const html = withCatalogue();
    const list = html.slice(html.indexOf('data-testid="check-catalogue"'));
    expect(list.match(/<li\b/g)).toHaveLength(6);
    expect(readable(list)).toContain(fr.console.check.catalogue.items["qc-residential-lease"].title);
    expect(readable(list)).not.toContain("qc-made-up");
    expect(list.match(new RegExp(escape(fr.console.check.catalogue.available), "g"))).toHaveLength(6);
    expect(list).toContain('href="/fr/app/check?type=lease#depot"');
    expect(list).toContain('href="/fr/app/check#depot"');
  });

  it("the chips carry the counts of each group, « Toutes » first", () => {
    const html = withCatalogue();
    const chips = html.slice(
      html.indexOf('data-testid="catalogue-chips"'),
      html.indexOf("</div>", html.indexOf('data-testid="catalogue-chips"')),
    );
    expect(readable(chips)).toMatch(/Toutes · 6\s+Baux · 3\s+Avis et états · 2\s+Authenticité · 1/);
  });

  it("the drop comes before the catalogue in the page (a phone reads one column: drop first), and the plan strip at the foot", () => {
    const html = withCatalogue();
    expect(html.indexOf('data-testid="check-drop"')).toBeLessThan(html.indexOf('data-testid="check-catalogue"'));
    expect(html.indexOf('data-testid="check-catalogue"')).toBeLessThan(html.indexOf('data-testid="plan-strip"'));
    expect(html).toContain('id="depot"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("lets both columns shrink to a phone's width (no horizontal scroll at 360 px): one column at mobile, 7/5 at 1440 px, min-w-0 children", () => {
    const html = withCatalogue();
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("min-[1440px]:grid-cols-[7fr_5fr]");
    expect(html).toMatch(/id="depot" class="[^"]*\bmin-w-0\b/);
    expect(html).toMatch(/<section class="[^"]*\bmin-w-0\b[^"]*"[^>]*aria-labelledby="catalogue-title"/);
  });

  it("without a catalogue or a billing state the page is the drop alone, as before", () => {
    const html = wrap(<CheckView />);
    expect(html).not.toContain('data-testid="check-catalogue"');
    expect(html).not.toContain('data-testid="plan-strip"');
    expect(html).toContain('data-testid="check-defaults"');
  });

  it("speaks English from the English dictionary", () => {
    const text = readable(withCatalogue({}, "en"));
    expect(text).toContain(en.console.check.catalogue.items["qc-residential-lease"].title);
    expect(text).toContain(en.console.check.plan.names.pro);
  });
});
