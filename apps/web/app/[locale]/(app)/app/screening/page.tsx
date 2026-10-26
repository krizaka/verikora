import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LandlordScreening, type LandlordWords } from "@/components/screening/LandlordScreening";
import { pageSession } from "@/lib/access";
import { appEnvironment } from "@/lib/env";
import { availableFlows, decideFlow, grantedConsents } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";
import { listForLandlord } from "@/lib/screening";
import { allowedFor, labelsIn } from "@/lib/screening-checks/catalogue";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).screening.landlord.title };
}

/** The landlord's screening page — only where the flow is enabled and offered to a landlord (ADR-0003); otherwise a 404. */
export default async function ScreeningPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  if (!session) notFound();
  const flows = await availableFlows(appEnvironment(), { fallback: false }).catch(() => []);
  const granted = await grantedConsents(session.account.id);
  const decision = decideFlow(flows, session.account.perspective, "tenant-screening", granted);
  if (!decision.ok && decision.code === "FLOW_NOT_OFFERED") notFound();
  const labels = await labelsIn(locale);
  const t = getDictionary(locale).screening.landlord;
  const words: LandlordWords = { ...t, result: { title: getDictionary(locale).screening.tenant.resultTitle, band: getDictionary(locale).screening.tenant.band, item: { ...getDictionary(locale).screening.tenant.item, ...labels }, outcome: getDictionary(locale).screening.tenant.outcome, note: t.reviewNote, incompleteNote: getDictionary(locale).screening.tenant.incompleteNote }, error: getDictionary(locale).console.errors.UNKNOWN };
  const offered = (await allowedFor(session.account.id)).map((c) => ({ key: c.key, label: labels[c.key] ?? c.key }));
  return <LandlordScreening initial={decision.ok ? await listForLandlord(session.account.id, new Date()) : []} offered={offered} undertakingGiven={decision.ok} words={words} locale={locale} />;
}
