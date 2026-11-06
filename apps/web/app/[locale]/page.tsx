import { CheckIcon, EyeIcon, SearchIcon } from "@krizaka/icons";
import { Card } from "@krizaka/ui/card";
import { CardGrid } from "@krizaka/ui/card-grid";
import { LandingPage } from "@krizaka/ui/landing-page";
import { Section } from "@krizaka/ui/page";
import type { Metadata } from "next";
import Link from "next/link";

import { BarQueryRoot, ClosingBody, HeroActions } from "@/components/BarSession";
import { BeforeAfter } from "@/components/home/BeforeAfter";
import { FindingsScreen } from "@/components/home/FindingsScreen";
import { LiveScreen } from "@/components/home/LiveScreen";
import { OwnerReportDocument } from "@/components/OwnerReportDocument";
import { SiteHeader } from "@/components/SiteChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { asLocale, format, getDictionary } from "@/lib/i18n";
import type { ConsoleMessages } from "@/lib/i18n-client";
import { HERO_FIGURES, productStatus } from "@/lib/landing";
import { demoOwnerDocument } from "@/lib/landing-demo";
import { recordedRun } from "@/lib/recorded-runs";
import { pageMetadata, siteJsonLd } from "@/lib/seo";
import { pagePath } from "@/lib/site";

import preview from "../../../../dev-preview.json";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return pageMetadata(asLocale((await params).locale), "home");
}

const DATE = { en: "en-CA", fr: "fr-CA" } as const;
const ICONS = { line: CheckIcon, file: EyeIcon, find: SearchIcon } as const;

/**
 * The home is the whole public site (Simplify Yomizaka, krizaka/yomizaka#120), on `LandingPage` since the UX review's Y9: the
 * promise beside the product's answer itself — the recorded check in a browser frame (the lease line, the finding, its article:
 * nothing drawn by hand, no screenshot until the final design is captured), the figures of that run under it —, the three
 * things as a bento, the run's facts and the owl once, who it is for, one way in (sign-in). Orazaka, the engine, is named
 * once, in a quiet line under the proof. Static: built from the recording.
 */
export default async function Home({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const dict = getDictionary(locale);
  const d = dict.landing;
  const run = recordedRun("tenant");
  const figures = HERO_FIGURES(run.report);
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
            actions={
              /* Signed in, « Ouvrir mes documents »; otherwise « Se connecter » and the status line — the same answer as the bar (F0). */
              <HeroActions locale={locale} status={d.status[productStatus(preview)]} />
            }
            visual={
              /* The product's answer, real (the recorded run), in a panel that grows with its text — the recorded steps take this place once the final design is captured. */
              <div
                className="rounded-lg border border-border-default bg-surface-1"
                data-testid="home-visual"
                role="group"
                aria-label={d.visual.caption}
              >
                <div data-testid="proof-run">
                  <BeforeAfter locale={locale} />
                </div>
              </div>
            }
            featuresHeading={{
              title: <span id="what">{d.what.title}</span>,
              lead: d.what.lead,
            }}
            /* Three things of the same weight: one row of the bento, no orphan card (P10). */
            features={(["line", "file", "find"] as const).map((id) => {
              const Icon = ICONS[id];
              return {
                id,
                title: d.what.items[id].title,
                text: d.what.items[id].text,
                icon: <Icon size={24} aria-hidden />,
              };
            })}
            closing={{
              title: d.closing.title,
              /* The closing call follows the same session answer as the hero (F0): signed in, the way to the documents; signed out, the way in. */
              body: <ClosingBody signedOut={d.closing.body} signedIn={d.closing.bodyIn} />,
              /* One way in on the page (the hero's); the closing says what happens to the documents and links the notice. */
              actions: (
                <span className="flex max-w-[70ch] flex-col gap-2 text-sm text-fg-secondary" data-testid="closing-data">
                  <span>{d.what.trust}</span>
                  <Link href={pagePath(locale, "privacy")} className="text-fg-accent underline underline-offset-4">
                    {d.what.privacy}
                  </Link>
                </span>
              ),
            }}
          >
            <Section id="app" title={d.showcase.title} lead={d.showcase.lead} spacing="sm" divider>
              <CardGrid min={340} align="start" reveal={false}>
                <Card.Root data-testid="feature-findings">
                  <Card.Body className="flex flex-col gap-3">
                    <Card.Title as="h3">{d.showcase.findings.title}</Card.Title>
                    <Card.Description>{d.showcase.findings.text}</Card.Description>
                    <p className="sr-only">{d.showcase.findings.summary}</p>
                    <LiveScreen testId="screen-findings">
                      <FindingsScreen
                        locale={locale}
                        messages={
                          {
                            console: { reportFace: dict.console.reportFace, analysis: dict.console.analysis },
                          } as unknown as ConsoleMessages
                        }
                        report={run.report}
                      />
                    </LiveScreen>
                  </Card.Body>
                </Card.Root>
                <Card.Root data-testid="feature-owner">
                  <Card.Body className="flex flex-col gap-3">
                    <Card.Title as="h3">{d.showcase.owner.title}</Card.Title>
                    <Card.Description>{d.showcase.owner.text}</Card.Description>
                    <p className="sr-only">{d.showcase.owner.summary}</p>
                    <LiveScreen testId="screen-owner">
                      <ol className="m-0 list-none p-4">
                        <OwnerReportDocument
                          doc={demoOwnerDocument(run)}
                          n={1}
                          words={dict.ownerReport}
                          lang={locale}
                        />
                      </ol>
                    </LiveScreen>
                  </Card.Body>
                </Card.Root>
              </CardGrid>
            </Section>
            <Section id="proof" title={d.proof.title} lead={d.proof.lead} spacing="sm" divider>
              <p className="text-sm text-fg-secondary">
                {format(d.proof.figures, { rules: figures.rules, found: figures.found })}
              </p>
              <p className="mt-1 text-xs text-fg-muted" data-testid="proof-meta">
                {d.proof.runLabel} {run.runId} · {d.proof.dateLabel}{" "}
                {new Date(run.recordedAt).toLocaleDateString(DATE[locale], {
                  dateStyle: "long",
                  timeZone: "America/Toronto",
                })}{" "}
                · {d.proof.rulesetLabel} {run.report.rulesetId} {run.report.rulesetVersion}
              </p>
              <p className="mt-6 text-xs text-fg-muted" data-testid="powered-by">
                {d.proof.powered}
              </p>
            </Section>
            <Section id="who" title={d.who.title} lead={d.what.who} spacing="sm" divider></Section>
          </LandingPage>
        </main>
      </BarQueryRoot>
      <SiteFooter locale={locale} />
    </>
  );
}
