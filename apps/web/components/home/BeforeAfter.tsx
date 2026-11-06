import { Badge } from "@krizaka/ui/badge";
import { passages } from "@verikora/core";

import { getDictionary, type Locale } from "@/lib/i18n";
import { HERO_RULE } from "@/lib/landing";
import { recordedRun } from "@/lib/recorded-runs";
import { atOffsets } from "@/lib/text-parts";

/**
 * One clear before/after, stacked so it is as sharp on a phone as on a desktop: the lease with the forbidden clause lit,
 * and under it the finding Verikora returns for that line, with its article of law. Both halves are read from the recorded
 * run (content/recorded-runs/tenant.json). It is the home's proof.
 */
export function BeforeAfter({ locale }: Readonly<{ locale: Locale }>) {
  const d = getDictionary(locale);
  const t = d.landing.hero;
  const run = recordedRun("tenant");
  const finding = run.report.findings.find((f) => f.ruleId === HERO_RULE)!;
  const quote = finding.evidenceSpan?.quote;
  // The lease's lines around the clause: enough to read it in its place, few enough to stay sharp on a phone.
  const lines = run.document.text.split("\n");
  const at = quote ? lines.findIndex((l) => l.includes(quote)) : -1;
  const excerpt = at >= 0 ? lines.slice(Math.max(0, at - 2), at + 3).join("\n") : run.document.text;
  const parts = passages(excerpt, quote ? [{ id: finding.ruleId, quote }] : []);
  return (
    <div className="flex w-full flex-col gap-3 p-4 sm:p-5" data-testid="before-after">
      <figure className="m-0 flex min-w-0 flex-col gap-2" aria-label={t.leaseCaption}>
        <figcaption className="text-xs font-semibold text-fg-muted">{t.before}</figcaption>
        <div className="whitespace-pre-wrap break-words rounded-lg border border-border-default bg-surface-1 p-3 text-sm leading-relaxed text-fg-secondary">
          {atOffsets(parts).map((p) =>
            p.mark ? (
              <mark key={p.at} className="ym-passage text-fg" title={p.mark}>
                {p.text}
              </mark>
            ) : (
              <span key={p.at}>{p.text}</span>
            ),
          )}
        </div>
      </figure>
      <span aria-hidden className="mx-auto text-lg text-fg-accent">
        ↓
      </span>
      <figure className="m-0 flex min-w-0 flex-col gap-2" aria-label={t.findingCaption}>
        <figcaption className="text-xs font-semibold text-fg-muted">{t.after}</figcaption>
        <div className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-surface-1 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 text-base font-semibold leading-snug text-fg">
              {finding.title ?? finding.ruleId}
            </span>
            <Badge tone="danger">{d.run.verdicts.FAIL}</Badge>
          </div>
          {quote ? (
            <p className="m-0 border-l-2 border-accent pl-3 text-sm italic text-fg-secondary">« {quote} »</p>
          ) : null}
          <p className="m-0 text-sm leading-relaxed text-fg-secondary">{finding.explanation}</p>
          <p className="m-0 text-sm font-semibold text-fg-accent" data-testid="hero-article">
            {finding.citation}
          </p>
        </div>
      </figure>
    </div>
  );
}
