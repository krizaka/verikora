import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplicantFile } from "@/components/applicant/ApplicantFile";
import { DISPLAY_TIME_ZONE, INTL } from "@/components/console/format";
import { SiteHeader } from "@/components/SiteChrome";
import { SiteFooter } from "@/components/SiteFooter";
import { activeConsents, NOTICE_VERSION } from "@/lib/applicant-consent";
import { applicantFileState, fileByToken } from "@/lib/applicant-file";
import { loadApplicantPage } from "@/lib/applicant-page";
import { asLocale, getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The applicant's page for an applicant file (verikora#341): public by token, never indexed, never cached. A screening's token opens its own page, not this one. */
export default async function ApplicantFilePage({
  params,
}: Readonly<{ params: Promise<{ locale: string; token: string }> }>) {
  const { locale: raw, token } = await params;
  const locale = asLocale(raw);
  const now = new Date();
  const loaded = await loadApplicantPage(token, now, { fileByToken, applicantFileState, activeConsents });
  if (!loaded) {
    notFound();
  }
  const t = getDictionary(locale);
  const expires = new Date(loaded.state.expiresAt).toLocaleDateString(INTL[locale], {
    dateStyle: "long",
    timeZone: DISPLAY_TIME_ZONE,
  });
  return (
    <>
      <SiteHeader locale={locale} current="home" />
      <main id="content" className="mx-auto w-full max-w-(--kz-page-max,72rem) px-(--kz-page-gutter,1rem) pb-16 pt-28">
        <ApplicantFile
          token={token}
          initial={loaded.state}
          consents={loaded.consents}
          noticeVersion={NOTICE_VERSION}
          words={{
            applicant: t.applicant,
            file: t.applicantFile,
            traces: t.console.analysis.traces,
            levels: t.console.analysis.levels,
            unknown: t.console.errors.UNKNOWN,
          }}
          locale={locale}
          expires={expires}
        />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
