import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WelcomeStart } from "@/components/console/WelcomeStart";
import { pageSession } from "@/lib/access";
import { appEnvironment } from "@/lib/env";
import { audiencesOf, availableFlows } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";
import { welcomeTarget } from "@/lib/library-screen";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.shell.titles.welcome };
}

/** The one-time onboarding step (krizaka-internal#2291): a property manager starts in one click; the other sides are behind « Autre usage ». Saved on the primary, then the home; changeable later in settings. */
export default async function WelcomePage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  const done = welcomeTarget(session?.account.perspective ?? null);
  if (done) redirect(`/${locale}${done}`);
  return <WelcomeStart audiences={audiencesOf(await availableFlows(appEnvironment()))} next={`/${locale}/app`} />;
}
