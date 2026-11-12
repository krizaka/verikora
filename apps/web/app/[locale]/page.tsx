import { CheckIcon, EyeIcon, LinkIcon } from "@krizaka/icons";
import { Button } from "@krizaka/ui/button";
import { LandingPage } from "@krizaka/ui/landing-page";
import { Mascot } from "@krizaka/ui/mascots";
import { Section } from "@krizaka/ui/page";
import type { Metadata } from "next";

import { BarQueryRoot } from "@/components/BarSession";
import { HeroFinding } from "@/components/home/HeroFinding";
import { RealReport } from "@/components/home/RealReport";
import { SiteHeader } from "@/components/SiteChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { HERO } from "@/content/recorded-runs/samples.mjs";
import { asLocale, getDictionary } from "@/lib/i18n";
import type { ConsoleMessages } from "@/lib/i18n-client";
import { productStatus } from "@/lib/landing";
import { recordedRun } from "@/lib/recorded-runs";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { contactHref } from "@/lib/site";

import preview from "../../../../dev-preview.json";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "home");
}

const DATE = { en: "en-CA", fr: "fr-CA" } as const;
const ICONS = { documents: EyeIcon, template: CheckIcon, report: LinkIcon } as const;

/**
 * The home is the whole public site (Simplify Verikora, krizaka/verikora#120), on `LandingPage` since the UX review's Y9: the
 * promise beside the product's answer itself — the recorded check in a browser frame (the lease line, the finding, its article:
 * nothing drawn by hand, no screenshot until the final design is captured), the figures of that run under it —, the three
 * things as a bento, the run's facts and the owl once, who it is for, one way in (the contact form, hero and closing). Sovkora, the engine, is named
 * once, in a quiet line under the proof. Static: built from the recording.
 */
export default async function Home({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const dict = getDictionary(locale);
  const d = dict.landing;
  const run = recordedRun(HERO.run);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <BarQueryRoot>
        <SiteHeader locale={locale} current="home" provider={false} />
        {/* The bar floats (a zero-height sticky wrapper): the hero's frame starts 24 px under it (`--kz-hero-top`, F6) — no void above the hero, nothing added on main. */}
        <main id="content" data-landing>
          <LandingPage
            title={d.title}
            lead={d.lead}
            visualLabel={d.hero.visualLabel}
            actions={
              <>
                <div className="flex flex-wrap items-center gap-3" data-testid="hero-actions">
                  <Button asChild variant="primary" size="lg" shape="cut">
                    <a href={contactHref("verikora-home-hero", locale, "business")} data-testid="hero-primary">
                      {d.hero.primary}
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="lg">
                    <a href="#proof" data-testid="hero-see-report">
                      {d.hero.seeReport}
                    </a>
                  </Button>
                </div>
                <p className="mt-4 max-w-[60ch] text-sm text-fg-secondary" data-testid="hero-status">
                  {d.status[productStatus(preview)]}
                </p>
              </>
            }
            visual={
              /* One finding of the recorded run (title, quote, article): read, never typed. */
              <div
                className="rounded-lg border border-border-default bg-surface-1"
                data-testid="home-visual"
                role="group"
                aria-label={d.visual.caption}
              >
                <HeroFinding locale={locale} />
              </div>
            }
            featuresHeading={{
              title: <span id="what">{d.what.title}</span>,
              lead: d.what.lead,
            }}
            /* Three things of the same weight: one row of the bento, no orphan card (P10). */
            features={(["documents", "template", "report"] as const).map((id) => {
              const Icon = ICONS[id];
              return {
                id,
                title: d.what.items[id].title,
                text: d.what.items[id].text,
                icon: <Icon size={24} aria-hidden />,
              };
            })}
          >
            <Section id="proof" title={d.proof.title} lead={d.proof.lead} spacing="sm" divider>
              <div data-testid="real-report">
                <RealReport
                  locale={locale}
                  messages={
                    {
                      console: { reportFace: dict.console.reportFace, analysis: dict.console.analysis },
                    } as unknown as ConsoleMessages
                  }
                  report={run.report}
                />
              </div>
              <details className="mt-4 rounded-lg border border-border-default bg-surface-1" data-testid="run-details">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-fg">
                  {d.proof.details}
                </summary>
                <div className="flex flex-col gap-1 px-4 pb-4 text-sm text-fg-secondary" data-testid="proof-meta">
                  <p className="m-0 [overflow-wrap:anywhere]">
                    {d.proof.runLabel} <code>{run.runId}</code>
                  </p>
                  <p className="m-0">
                    {d.proof.dateLabel}{" "}
                    {new Date(run.recordedAt).toLocaleDateString(DATE[locale], {
                      dateStyle: "long",
                      timeZone: "America/Toronto",
                    })}
                  </p>
                  <p className="m-0">
                    {d.proof.rulesetLabel} {run.report.rulesetId} {run.report.rulesetVersion}
                  </p>
                  <p className="m-0 mt-2 text-fg-muted" data-testid="powered-by">
                    {d.proof.powered}
                  </p>
                </div>
              </details>
            </Section>
            <Section id="applicant" title={d.applicant.title} lead={d.applicant.lead} spacing="sm" divider>
              <div className="flex flex-wrap items-start gap-4" data-testid="applicant-agrees">
                <span aria-hidden className="shrink-0">
                  <Mascot bird="owl" mood="welcome" size={64} />
                </span>
                <ul className="m-0 flex min-w-0 flex-1 basis-64 list-disc flex-col gap-2 pl-5 text-fg-secondary">
                  {d.applicant.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            </Section>
            <Section id="closing" title={d.closing.title} spacing="sm" divider>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="closing-actions">
                <Button asChild variant="primary" size="lg" shape="cut">
                  <a href={contactHref("verikora-home-closing", locale, "business")} data-testid="closing-primary">
                    {d.hero.primary}
                  </a>
                </Button>
                <a
                  href="#applicant"
                  className="text-fg-accent underline underline-offset-4"
                  data-testid="closing-tenant"
                >
                  {d.closing.tenant}
                </a>
              </div>
            </Section>
          </LandingPage>
        </main>
      </BarQueryRoot>
      <SiteFooter locale={locale} />
    </>
  );
}
