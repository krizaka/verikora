import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { storesOf } from "@/app/active-store";
import { systemClock } from "@/app/system-clock";
import { DocumentView } from "@/components/console/DocumentView";
import { pageSession } from "@/lib/access";
import { isDocumentTab, movedDocumentHref, searchOf } from "@/lib/console-nav";
import { query } from "@/lib/db";
import { documentStorage, getDocument } from "@/lib/documents";
import { appEnvironment } from "@/lib/env";
import { availableFlows, offerFor } from "@/lib/flows";
import { HttpError } from "@/lib/http";
import { asLocale, getDictionary } from "@/lib/i18n";
import { leaseBundle } from "@/lib/lease-bundle";
import { placeOf } from "@/lib/organisation/store";
import { registries, registryReport } from "@/lib/registries";
import { withFeatures } from "@/lib/settings/boundary";
import { insightFeatures } from "@/lib/settings/guards";
import { answersOf } from "@/lib/signal-answers";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.shell.document };
}

/** One document, one tab per route — another person's document is a 404, never a 403; an old tab address answers 308 to its tab; an unknown tab is a 404. */
export default async function DocumentTabPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string; id: string; tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { locale, id, tab } = await params;
  // An old tab address answers 308 to its tab with its query kept (`?refused=`, `?analysis=`), by the map's own keys only.
  const moved = movedDocumentHref(asLocale(locale), id, tab, searchOf(await searchParams));
  if (moved) {
    permanentRedirect(moved);
  }
  if (!isDocumentTab(tab)) {
    notFound();
  }
  const session = await pageSession();
  if (!session) {
    notFound();
  }
  const document = await getDocument(session.account.id, id)
    .then(async (d) => ({
      ...withFeatures(d, await insightFeatures(session.account.id)),
      ...(await documentStorage(session.account.id, id, (await storesOf(session.account.id)).describe)),
    }))
    .catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 404) {
        return null;
      }
      throw error;
    });
  if (!document) {
    notFound();
  }
  // The lease and its annexes read as one (verikora#499): read for the report tab only, and shown only when there are annexes.
  const bundle = tab === "rapport" ? await leaseBundle(session.account.id, id) : null;
  // The QST number printed on the document, read against Revenu Québec's public register (verikora#627): the report tab only.
  const registry =
    tab === "rapport" && document.insight
      ? await registryReport(document.insight.understanding, registries(systemClock), systemClock.now())
      : null;
  return (
    <DocumentView
      initial={document}
      tab={tab}
      bundle={bundle}
      registry={registry}
      place={await placeOf(query, session.account.id, id)}
      perspective={session.account.perspective}
      answers={Object.fromEntries((await answersOf([id])).get(id) ?? [])}
      offer={offerFor(await availableFlows(appEnvironment()), session.account.perspective)}
    />
  );
}
