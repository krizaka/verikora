import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TenantScreening, type TenantWords } from "@/components/screening/TenantScreening";
import { SiteHeader } from "@/components/SiteChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { HttpError } from "@/lib/http";
import { asLocale, getDictionary } from "@/lib/i18n";
import { viewForTenant } from "@/lib/screening";
import { labelsIn } from "@/lib/screening-checks/catalogue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The applicant's page (the link the landlord handed over): public by token, never indexed, never cached. */
export default async function TenantScreeningPage({ params }: Readonly<{ params: Promise<{ locale: string; token: string }> }>) {
  const { locale: raw, token } = await params;
  const locale = asLocale(raw);
  const t = getDictionary(locale).screening.tenant;
  const view = await viewForTenant(token, new Date()).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  if (!view) notFound();
  const labels = await labelsIn(locale);
  const words: TenantWords = { ...t, scope: labels, result: { title: t.resultTitle, band: t.band, item: { ...t.item, ...labels }, outcome: t.outcome, incompleteNote: t.incompleteNote }, error: getDictionary(locale).console.errors.UNKNOWN };
  return (
    <>
      <SiteHeader locale={locale} current="home" />
      <main id="content" className="mx-auto w-full max-w-(--kz-page-max,72rem) px-(--kz-page-gutter,1rem) pb-16 pt-28">
        <TenantScreening token={token} initial={view} words={words} locale={locale} />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
