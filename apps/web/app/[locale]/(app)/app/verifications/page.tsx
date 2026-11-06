import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChecksView } from "@/components/console/ChecksView";
import { pageSession } from "@/lib/access";
import { getAnalysis } from "@/lib/analyses";
import { listChecks } from "@/lib/checks";
import { runningChecks } from "@/lib/checks-live";
import { query } from "@/lib/db";
import { asLocale, getDictionary } from "@/lib/i18n";
import { featureOn } from "@/lib/settings/guards";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.shell.titles.checks };
}

/** Vérifications: every check of the account, newest first — and the batches under `?tab=lots` when the workspace has them. */
export default async function ChecksPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const [listed, batches] = await Promise.all([
    listChecks(query, session.account.id),
    featureOn("batches", session.account.id),
  ]);
  // A running check is refreshed from Sovkora here (as its own page does), so the list never stays « Analysing » after the run ended.
  const running = runningChecks(listed);
  if (running.length)
    await Promise.all(running.map((c) => getAnalysis(session.account.id, c.documentId, c.id).catch(() => null)));
  const checks = running.length ? await listChecks(query, session.account.id) : listed;
  return <ChecksView checks={checks} batches={batches} now={new Date().toISOString()} />;
}
