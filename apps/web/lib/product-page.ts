import type { ClauseLine } from "@krizaka/ui/clause-demo";
import type { ProductScene } from "@krizaka/ui/product-page";
import type { DeviceKind } from "@krizaka/ui/step-showcase";
import { z } from "zod";

import data from "@/content/product-page.json";
import { HERO, SAMPLES } from "@/content/recorded-runs/samples.mjs";

import type { Locale } from "./i18n";
import { recordedRun } from "./recorded-runs";
import { type RoleMedia, sectionMedia } from "./section-media";

const BUDGET_KEYS = [
  "hero.title",
  "hero.lead",
  "scene.title",
  "scene.line",
  "story.step",
  "demo.title",
  "limit",
  "closing.title",
] as const;

/** The birds that can guide a product page (each a product's own: the owl reads documents). A client module's list cannot be read on the server. */
const GUIDE_BIRDS = ["owl", "falcon", "duck", "flamingo", "pigeon"] as const;

/** The steps the story stage can draw, in the journey's order: the file arrives, is read, a clause lights up, its article attaches, you decide. */
export const STORY_STEPS = ["arrive", "read", "light", "attach", "decide"] as const;
export type StoryStep = (typeof STORY_STEPS)[number];
type BudgetKey = (typeof BUDGET_KEYS)[number];

const template = z.object({
  /** The registry page whose scenes the template shows. */
  page: z.string(),
  /** The registry role of a scene. */
  sceneRole: z.string(),
  /** The limits band's lines, by id (their words are in the catalogue). */
  limits: z.array(z.string()).min(1).max(3),
  /** The most words each section may say. */
  budget: z.record(z.enum(BUDGET_KEYS), z.number().int().positive()),
  /** The one journey the page tells while it scrolls, and the bird that guides it. */
  story: z.object({ steps: z.array(z.enum(STORY_STEPS)).min(3).max(5), bird: z.enum(GUIDE_BIRDS) }),
});
export type ProductPageTemplate = z.infer<typeof template>;

export const parseTemplate = (raw: unknown): ProductPageTemplate => template.parse(raw);

/** The product page's structure, parsed once: `content/product-page.json` (krizaka-internal#4692). */
export const PRODUCT_PAGE: ProductPageTemplate = parseTemplate(data);

/** The words of the template, as the catalogue holds them (`productPage`). */
export interface ProductPageWords {
  hero: { title: string; lead: string };
  scenes: Readonly<Record<string, { title: string; line?: string } | undefined>>;
  story: { steps: Readonly<Record<string, { title: string } | undefined>>; review: string; keep: string; seal: string };
  demo: { title: string };
  limits: { title: string; items: Readonly<Record<string, string | undefined>> };
  closing: { title: string };
}

/** The scenes of the page in a language: the registry's media of the scene role, one per words id. */
export function sceneMedia(locale: Locale, page: ProductPageTemplate = PRODUCT_PAGE): RoleMedia[] {
  const seen = new Set<string>();
  return sectionMedia(page.page, page.sceneRole, locale).filter((m) => !seen.has(m.id) && seen.add(m.id));
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The sections whose words go over their budget, named `hero.title`, `scene.web-report.line`, `limit.decide`. */
export function overBudget(words: ProductPageWords, budget: ProductPageTemplate["budget"]): string[] {
  const over = (key: BudgetKey, text: string | undefined) => (budget[key] ?? Infinity) < wordCount(text ?? "");
  const scenes = Object.entries(words.scenes).flatMap(([id, s]) => [
    ...(over("scene.title", s?.title) ? [`scene.${id}.title`] : []),
    ...(over("scene.line", s?.line) ? [`scene.${id}.line`] : []),
  ]);
  const steps = Object.entries(words.story.steps).flatMap(([id, step]) =>
    over("story.step", step?.title) ? [`story.${id}`] : [],
  );
  const limits = Object.entries(words.limits.items).flatMap(([id, text]) =>
    over("limit", text) ? [`limit.${id}`] : [],
  );
  return [
    ...(over("hero.title", words.hero.title) ? ["hero.title"] : []),
    ...(over("hero.lead", words.hero.lead) ? ["hero.lead"] : []),
    ...scenes,
    ...steps,
    ...(over("demo.title", words.demo.title) ? ["demo.title"] : []),
    ...limits,
    ...(over("closing.title", words.closing.title) ? ["closing.title"] : []),
  ];
}

/** A sample's lines, the one that holds the finding's quote flagged: the hero's lease, read from the recording, never typed. */
export function leaseLines(text: string, quote: string): { text: string; flagged: boolean }[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ({ text: line, flagged: quote.length > 0 && line.includes(quote) }));
}

/** The frame a recording is shown in, by the platform it was recorded on. */
const DEVICE: Readonly<Record<string, DeviceKind | undefined>> = {
  web: "browser",
  mac: "desktop",
  windows: "desktop",
  linux: "desktop",
  android: "phone",
  ios: "phone",
};

/** The scenes the page shows in a language: a registry media with its words; one without words is left out. */
export function productScenes(locale: Locale, words: ProductPageWords["scenes"]): ProductScene[] {
  return sceneMedia(locale).flatMap((m) => {
    const said = words[m.id];
    return said
      ? [
          {
            ...said,
            id: m.id,
            device: DEVICE[m.video.platform] ?? "browser",
            poster: m.poster,
            sources: { webm: m.webm, mp4: m.mp4 },
            width: m.width,
            height: m.height,
          },
        ]
      : [];
  });
}

/** The words a visitor reads on the page, counted: the text budget of the whole page (about ninety). */
export function pageWords(words: ProductPageWords): number {
  const said = [
    words.hero.title,
    words.hero.lead,
    ...Object.values(words.scenes).flatMap((s) => [s?.title, s?.line]),
    ...Object.values(words.story.steps).map((s) => s?.title),
    words.story.review,
    words.story.keep,
    words.story.seal,
    words.demo.title,
    words.limits.title,
    ...Object.values(words.limits.items),
    words.closing.title,
  ];
  return said.reduce((sum, text) => sum + wordCount(text ?? ""), 0);
}

/** What the recorded check said of one clause, before it is worded for a language. */
export interface ClauseFinding {
  ruleId: string;
  verdict: string;
  quote: string | null;
  citation: string;
  title?: string | null;
}

/** The verdicts a visitor should see first on a line: a point not respected before one that lacks evidence, before a respected one. */
const VERDICT_ORDER: Readonly<Record<string, number | undefined>> = { FAIL: 0, INSUFFICIENT_EVIDENCE: 1, PASS: 2 };
const rank = (f: ClauseFinding) => VERDICT_ORDER[f.verdict] ?? 3;

/** The colour of a verdict: a closed set the template draws. */
export const VERDICT_TONE = { FAIL: "danger", INSUFFICIENT_EVIDENCE: "warning", PASS: "success" } as const;
export type VerdictTone = (typeof VERDICT_TONE)[keyof typeof VERDICT_TONE] | "neutral";
export const toneOf = (verdict: string): VerdictTone => VERDICT_TONE[verdict as keyof typeof VERDICT_TONE] ?? "neutral";

/** Each line of a lease with the finding that quotes it (the most telling one), or none: the micro-demo's data. */
export function clauseLines<F extends ClauseFinding>(
  text: string,
  findings: readonly F[],
): { text: string; finding?: F }[] {
  const quoted = findings
    .filter((f) => f.quote)
    .sort((a, b) => rank(a) - rank(b) || (b.quote?.length ?? 0) - (a.quote?.length ?? 0));
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const finding = quoted.find((f) => line.includes(f.quote ?? ""));
      return finding ? { text: line, finding } : { text: line };
    });
}

/** The hero run's lease, each line with what the recorded check said of it (never typed). */
export function recordedClauseLines(): { text: string; finding?: ClauseFinding }[] {
  const run = recordedRun(HERO.run as "landlord");
  const findings = run.report.findings.map((f) => ({
    ruleId: f.ruleId,
    verdict: f.verdict,
    quote: f.evidenceSpan?.quote ?? null,
    citation: f.citation ?? "",
    title: f.title,
  }));
  return clauseLines(SAMPLES[HERO.run as keyof typeof SAMPLES].text, findings);
}

/** The words of a verdict and of a rule, in the page's language (the catalogues'). */
export interface ClauseWords {
  verdicts: Readonly<Record<string, string | undefined>>;
  ruleTitle: (ruleId: string, fallback?: string | null) => string;
}

/** The micro-demo's lines for the template: each recorded line with its finding worded in the page's language. */
export function demoLines(words: ClauseWords): ClauseLine[] {
  return recordedClauseLines().map((c, i) => ({
    id: `line-${i}`,
    text: c.text,
    ...(c.finding && {
      finding: {
        verdict: words.verdicts[c.finding.verdict] ?? c.finding.verdict,
        tone: toneOf(c.finding.verdict),
        title: words.ruleTitle(c.finding.ruleId, c.finding.title),
        ...(c.finding.quote && { quote: c.finding.quote }),
        reference: c.finding.citation,
      },
    }),
  }));
}
