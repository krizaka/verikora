import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { pageSession } from "@/lib/access";
import { query } from "@/lib/db";
import { appEnvironment } from "@/lib/env";
import { applicantFilesOffered, availableFlows } from "@/lib/flows";
import { filesToDecide } from "@/lib/home";
import { asLocale } from "@/lib/i18n";

// The signed-in space is never indexed and never cached: it reads the session on every request.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The signed-in space: no session, no page. The administration lives apart, on admin.verikora.com (app/[locale]/(admin)). */
export default async function ConsoleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  if (!session) redirect(`/${locale}/sign-in`);
  // « Dossiers » joins the rail only for the people offered the applicant-file flow (the section map, verikora#319).
  const applicantFiles = applicantFilesOffered(
    await availableFlows(appEnvironment()),
    session.account.perspective ?? null,
  );
  const toDecide = applicantFiles ? await filesToDecide(query, session.account.id, new Date()) : 0;
  return (
    <ConsoleShell
      applicantFiles={applicantFiles}
      toDecide={toDecide}
      locale={locale}
      email={session.account.email}
      name={session.account.name ?? undefined}
      avatarSeed={session.account.avatarSeed ?? undefined}
      role={session.account.role}
    >
      {children}
    </ConsoleShell>
  );
}
