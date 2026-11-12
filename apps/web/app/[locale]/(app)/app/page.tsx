import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LibraryView } from "@/components/console/LibraryView";
import { PaymentProblem } from "@/components/console/PaymentProblem";
import { PaymentReturn } from "@/components/console/PaymentReturn";
import { SAMPLES } from "@/content/recorded-runs/samples.mjs";
import { pageSession } from "@/lib/access";
import { listApplicantFiles } from "@/lib/applicant-file";
import { entitlementOf } from "@/lib/billing";
import { listChecks } from "@/lib/checks";
import { creditsOf } from "@/lib/credits";
import { query } from "@/lib/db";
import { appEnvironment } from "@/lib/env";
import { applicantFilesOffered, availableFlows, offerFor } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";
import { onboardingTarget } from "@/lib/library-screen";
import * as org from "@/lib/organisation/store";
import { paymentProblemOf } from "@/lib/payment-problem";
import { PAID_KEY, paymentReturnOf } from "@/lib/payment-return";
import { purgeExpired } from "@/lib/retention";

/** The newest checks the home reads (one bounded query): the last five are listed, and « À traiter » picks the ones to look at among them. */
// @fixed: a bound on the home's read, not a business parameter
const HOME_CHECKS = 50;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.meta.library };
}

/** The home (krizaka-internal#1898): the check to start, the dossiers (collections and applicant files), the plan and usage in one line; read on the server. */
export default async function LibraryPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const locale = asLocale((await params).locale);
  const search = await searchParams;
  const session = await pageSession();
  const onboarding = session ? onboardingTarget(session.account.perspective ?? null) : null;
  if (onboarding) {
    redirect(`/${locale}${onboarding}`);
  }
  const perspective = session?.account.perspective ?? null;
  const flows = await availableFlows(appEnvironment());
  const screeningOffered = !!session && applicantFilesOffered(flows, perspective);
  const owner = session?.account.id;
  if (!owner) {
    return null;
  }
  // The sweep: documents that were not kept and never checked are purged once their window has passed.
  await purgeExpired(query, new Date());
  await org.ensureLibrary(query, owner, getDictionary(locale).console.organisation.library);
  const now = new Date();
  const [libraries, files, credits, entitlement, checks] = await Promise.all([
    org.overview(query, owner),
    screeningOffered ? listApplicantFiles(owner, now) : Promise.resolve([]),
    creditsOf(owner, now),
    entitlementOf(query, owner, now),
    listChecks(query, owner, HOME_CHECKS),
  ]);
  const documents = libraries.reduce((n, l) => n + l.collections.reduce((m, c) => m + c.files, 0), 0);
  const paid = paymentReturnOf(search[PAID_KEY]);
  const view = (
    <LibraryView
      libraries={libraries}
      documents={documents}
      files={files}
      checks={checks}
      perspective={perspective}
      screening={screeningOffered}
      examples={SAMPLES}
      jurisdictions={offerFor(flows, perspective).jurisdictions}
      credits={credits}
    />
  );
  const problem = paymentProblemOf(entitlement);
  return paid || problem ? (
    <>
      {problem ? <PaymentProblem /> : null}
      {paid ? <PaymentReturn result={paid} /> : null}
      {view}
    </>
  ) : (
    view
  );
}
