import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LibraryView } from "@/components/console/LibraryView";
import { SAMPLES } from "@/content/recorded-runs/samples.mjs";
import { pageSession } from "@/lib/access";
import { listChecks } from "@/lib/checks";
import { query } from "@/lib/db";
import { documentsByIds } from "@/lib/documents";
import { appEnvironment } from "@/lib/env";
import { availableFlows, flowsFor, offerFor } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";
import { onboardingTarget } from "@/lib/library-screen";
import * as org from "@/lib/organisation/store";
import { purgeExpired } from "@/lib/retention";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.meta.library };
}

/** The library's first screen: libraries and collections, « Récents » (ADR-0007); the first list is read on the server. */
export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  const onboarding = session ? onboardingTarget(session.account.perspective ?? null) : null;
  if (onboarding) redirect(`/${locale}${onboarding}`);
  const perspective = session?.account.perspective ?? null;
  const flows = await availableFlows(appEnvironment());
  const screeningOffered = !!session && flows.some((f) => f.key === "tenant-screening" && flowsFor([f], perspective).length > 0);
  const owner = session?.account.id;
  if (!owner) return null;
  // The sweep: documents that were not kept and never checked are purged once their window has passed.
  await purgeExpired(query, new Date());
  await org.ensureLibrary(query, owner, getDictionary(locale).console.organisation.library);
  const [libraries, recents, tags, latest] = await Promise.all([org.overview(query, owner), org.recentIds(query, owner, 20).then((ids) => documentsByIds(owner, ids)), org.listTags(query, owner), listChecks(query, owner, 5)]);
  return <LibraryView libraries={libraries} recents={recents} latest={latest} tags={tags} perspective={perspective} screening={screeningOffered} examples={SAMPLES} jurisdictions={offerFor(flows, perspective).jurisdictions} />;
}
