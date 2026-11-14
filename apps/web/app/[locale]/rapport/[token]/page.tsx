import { Page, Section } from "@krizaka/ui/page";
import { PageHero } from "@krizaka/ui/page-hero";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/ButtonLink";
import { DISPLAY_TIME_ZONE, INTL } from "@/components/console/format";
import { OwnerReportDocument } from "@/components/OwnerReportDocument";
import { SiteHeader } from "@/components/SiteChrome";
import { ProductFooter } from "@/components/SiteFooter";
import { asLocale, format, getDictionary } from "@/lib/i18n";
import { limit } from "@/lib/limits";
import { pickReportLang } from "@/lib/owner-report-lang";
import { openShare } from "@/lib/owner-report-shares";
import { pagePath } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The building owner's page (verikora#128): a read-only report by link, public by token, never indexed, never cached; no account, no document. */
export default async function OwnerReportPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ locale: string; token: string }>; searchParams: Promise<{ lang?: string }> }>) {
  const { locale: raw, token } = await params;
  const locale = asLocale(raw);
  const h = await headers();
  // The report's language: the toggle (`?lang=`), else the browser's, else the page's. The words are the messages', never translated at runtime.
  const lang = pickReportLang((await searchParams).lang, h.get("accept-language"), locale);
  const t = getDictionary(lang);
  const w = t.ownerReport;
  await limit("applicant", { headers: h }, null);
  const now = new Date();
  const report = await openShare(token, now, h);
  // One answer for an unknown, expired or revoked link: 404, nothing leaks (verikora#128).
  if (!report) notFound();
  const back = { href: pagePath(locale, "home"), label: t.meta.siteName };
  const date = new Date(report.issuedAt).toLocaleDateString(INTL[lang], {
    dateStyle: "long",
    timeZone: DISPLAY_TIME_ZONE,
  });
  return (
    <>
      <SiteHeader locale={locale} current="home" />
      <main id="content">
        <PageHero back={back} linkAs={Link} title={w.title} backdrop="plain" lead={w.lead}>
          <p>
            {format(w.reference, { ref: report.reference })} · {format(w.issued, { date })}
          </p>
          <p>{w.notice}</p>
          <p>
            {format(w.expires, {
              date: new Date(report.expiresAt).toLocaleDateString(INTL[lang], {
                dateStyle: "long",
                timeZone: DISPLAY_TIME_ZONE,
              }),
            })}
          </p>
          <ButtonLink href={`/api/rapport/${encodeURIComponent(token)}/pdf?locale=${lang}`} variant="secondary">
            {w.download}
          </ButtonLink>
          <nav aria-label={w.language} className="flex items-center gap-2 text-sm">
            <span>{w.language}</span>
            {(["en", "fr"] as const).map((l) => (
              <Link
                key={l}
                href={`?lang=${l}`}
                lang={l}
                aria-current={l === lang ? "true" : undefined}
                className={l === lang ? "font-semibold underline" : "underline"}
              >
                {w.languageName[l]}
              </Link>
            ))}
          </nav>
        </PageHero>
        <Page>
          <Section>
            <h2 className="text-xl font-semibold">{w.documents}</h2>
            <ol className="mt-4 grid gap-4">
              {report.documents.map((d, i) => (
                <OwnerReportDocument key={d.sha256} doc={d} n={i + 1} words={w} lang={lang} />
              ))}
            </ol>
            {report.rulesets.map((r) => (
              <p key={`${r.rulesetId}-${r.rulesetVersion}`} className="mt-4 text-sm">
                {format(w.ruleset, { id: r.rulesetId, version: r.rulesetVersion, jurisdiction: r.jurisdiction })}
                {r.reviewStatus ? ` ${format(w.reviewStatus, { status: r.reviewStatus })}` : ""}
              </p>
            ))}
            <p className="mt-6 text-sm text-fg-secondary">{w.limits}</p>
            <p className="mt-2 text-sm text-fg-secondary">{w.languageNote}</p>
          </Section>
        </Page>
      </main>
      <ProductFooter locale={locale} />
    </>
  );
}
