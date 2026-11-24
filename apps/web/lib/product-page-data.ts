import type { ProductPageData } from "@krizaka/ui/product-page";

import { BRAND_ID } from "./brand";
import { HERO, SAMPLES } from "@/content/recorded-runs/samples.mjs";

import { getDictionary, type Locale } from "./i18n";
import { heroFinding } from "./landing";
import { demoLines, leaseLines, PRODUCT_PAGE, productScenes, toneOf } from "./product-page";
import { ruleTitle } from "./rule-text";

/** The addresses of the page's two ways in: the contact form (the first) and the sample report's page (the second). */
export interface ProductPageLinks {
  demo: (source: string) => string;
  sample: string;
}

/**
 * Everything the home shows, as the template's data (krizaka-internal#4692, #4634): the words come from the catalogue
 * (`productPage`), the media from the registry (by role), the lease and its finding from the recorded run — nothing is typed here,
 * and no product's name: the template draws, the data says.
 */
export function homePageData(locale: Locale, links: ProductPageLinks): ProductPageData {
  const dict = getDictionary(locale);
  const w = dict.productPage;
  const finding = heroFinding();
  const title = ruleTitle(finding.ruleId, locale, finding.title);
  const reference = finding.citation ?? "";
  const lines = leaseLines(SAMPLES[HERO.run as keyof typeof SAMPLES].text, finding.evidenceSpan?.quote ?? "");
  const scenes = productScenes(locale, w.scenes);
  const labels = { play: w.inner.play, pause: w.inner.pause };
  return {
    brand: BRAND_ID,
    hero: {
      title: w.hero.title,
      lead: w.hero.lead,
      primary: { href: links.demo("verikora-home-hero"), label: w.hero.primary },
      secondary: { href: links.sample, label: w.hero.secondary },
      ...(scenes[0] && { backdrop: scenes[0].poster }),
    },
    moment: {
      label: w.hero.moment,
      tag: w.hero.sample,
      lines,
      finding: {
        verdict: dict.run.verdicts[finding.verdict as keyof typeof dict.run.verdicts] ?? finding.verdict,
        tone: toneOf(finding.verdict),
        title,
        reference,
      },
      id: "proof",
    },
    story: {
      label: w.story.label,
      steps: PRODUCT_PAGE.story.steps.map((id) => ({ id, cue: id, title: w.story.steps[id]?.title ?? id })),
      guide: PRODUCT_PAGE.story.bird,
      scene: {
        lines,
        reference,
        decision: { title, primary: w.story.review, secondary: w.story.keep, stamp: w.story.seal },
      },
    },
    demo: {
      title: w.demo.title,
      tag: w.hero.sample,
      lines: demoLines({
        verdicts: dict.run.verdicts,
        ruleTitle: (ruleId, fallback) => ruleTitle(ruleId, locale, fallback),
      }),
    },
    scenes: { items: scenes, labels, id: "what" },
    limits: {
      title: w.limits.title,
      items: PRODUCT_PAGE.limits.flatMap((id) => w.limits.items[id as keyof typeof w.limits.items] ?? []),
      bird: PRODUCT_PAGE.story.bird,
      caption: `${w.owl.figure} · ${w.owl.label}, ${w.owl.promise}`,
    },
    closing: { title: w.closing.title, action: { href: links.demo("verikora-home-closing"), label: w.hero.primary } },
  };
}
