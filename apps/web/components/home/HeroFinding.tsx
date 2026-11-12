import { Badge } from "@krizaka/ui/badge";

import { getDictionary, type Locale } from "@/lib/i18n";
import { heroFinding } from "@/lib/landing";
import { ruleTitle } from "@/lib/rule-text";

/**
 * The hero's visual (krizaka-internal#2562): ONE finding of a recorded run (named by `HERO` in `content/recorded-runs/samples.mjs`): its title (the rule catalogue's, in the page's language),
 * the quoted line and its article of law. Nothing is typed here: a page whose run has no such finding does not build.
 */
export function HeroFinding({ locale }: Readonly<{ locale: Locale }>) {
  const d = getDictionary(locale);
  const finding = heroFinding();
  const quote = finding.evidenceSpan?.quote;
  return (
    <figure
      className="m-0 flex w-full min-w-0 flex-col gap-3 p-4 sm:p-5"
      data-testid="hero-finding"
      aria-label={d.landing.hero.findingCaption}
    >
      <div className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-surface-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 text-base font-semibold leading-snug text-fg">
            {ruleTitle(finding.ruleId, locale, finding.title)}
          </span>
          <Badge tone="danger">{d.run.verdicts.FAIL}</Badge>
        </div>
        {quote ? (
          <blockquote className="m-0 border-l-2 border-accent pl-3 text-sm italic text-fg-secondary">
            « {quote} »
          </blockquote>
        ) : null}
        <p className="m-0 text-sm font-semibold text-fg-accent" data-testid="hero-article">
          {finding.citation}
        </p>
      </div>
    </figure>
  );
}
