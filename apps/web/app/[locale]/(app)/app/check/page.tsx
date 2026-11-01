import type { Metadata } from "next";

import { CheckView } from "@/components/console/CheckView";
import { pageSession } from "@/lib/access";
import { catalogueOf } from "@/lib/check-catalogue";
import { creditsOf } from "@/lib/credits";
import { displayNow } from "@/lib/display-now";
import { appEnvironment, appVisualNow } from "@/lib/env";
import { availableFlows, offerFor } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.shell.titles.check };
}

/** Check a document: the drop zone first; a file that landed opens on its report, the check started when its kind is sure. */
export default async function CheckPage() {
  const session = await pageSession();
  const offer = offerFor(await availableFlows(appEnvironment()), session?.account.perspective ?? null);
  const now = new Date();
  return (
    <CheckView
      jurisdictions={offer.jurisdictions}
      catalogue={catalogueOf(offer)}
      credits={session ? await creditsOf(session.account.id, now) : null}
      now={displayNow(now, appEnvironment(), appVisualNow()).toISOString()}
    />
  );
}
