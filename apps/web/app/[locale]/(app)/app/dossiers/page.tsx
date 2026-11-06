import { parseView } from "@krizaka/organize/contract";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { systemClock } from "@/app/system-clock";
import { ApplicantFilesNotOffered } from "@/components/console/ApplicantFilesNotOffered";
import { FilesView } from "@/components/console/FilesView";
import { pageSession } from "@/lib/access";
import { countApplicantFiles, documentTypes, listApplicantFiles } from "@/lib/applicant-file";
import { askableTypes } from "@/lib/applicant-file-face";
import { searchOf } from "@/lib/console-nav";
import { appEnvironment } from "@/lib/env";
import { applicantFilesOffered, availableFlows } from "@/lib/flows";
import { readFileStates } from "@/lib/home-figures";
import { asLocale, getDictionary } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";
import { binderPlan } from "@/lib/workspace/binder";
import { KIND } from "@/lib/workspace/decl";
import { workspaceFor } from "@/lib/workspace/service";
import { asTag } from "@/lib/workspace/tags";
import { resolveView } from "@/lib/workspace/view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.dossiers.title };
}

/** « Dossiers »: the applicant files of the account (filtered by the link's state with `?state=`) — for the people offered the flow (the section map); the others read who it is for (krizaka-internal#2289). */
export default async function FilesPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const locale = asLocale((await params).locale);
  const session = await pageSession();
  if (!session) notFound();
  if (!applicantFilesOffered(await availableFlows(appEnvironment()), session.account.perspective ?? null))
    return <ApplicantFilesNotOffered locale={locale} />;
  // The organised workspace (verikora#324): the decision set and the views are data; the address holds the filters (`?view=&tags=&status=`).
  const workspace = workspaceFor({ clock: systemClock });
  const owner = session.account.id;
  const search = await searchParams;
  const [configuration, tags, views] = await Promise.all([
    workspace.config.get(KIND.applicantFile),
    workspace.tags.list(owner, KIND.applicantFile),
    workspace.views.list(owner, { id: owner, label: session.account.email, role: "owner" }, KIND.applicantFile),
  ]);
  const set = configuration?.config.status ?? null;
  const resolved = resolveView(
    parseView(search as Record<string, string | string[] | undefined>),
    views.system,
    [...views.workspace, ...views.mine],
    locale,
  );
  const [files, types] = await Promise.all([
    listApplicantFiles(owner, new Date(), { filters: resolved.filters, set }),
    documentTypes(),
  ]);
  // The binder's counts are the lengths of the views: the same filter as the list (verikora#334).
  const plan = set
    ? binderPlan(
        set,
        tags.map((t) => t.id),
        resolved.filters,
      )
    : null;
  const counts = plan
    ? {
        tabs: await Promise.all(plan.tabs.map((tab) => countApplicantFiles(owner, { filters: tab.filters, set }))),
        chips: await Promise.all(
          plan.chips.map((chip) => countApplicantFiles(owner, { filters: chip.countFilters, set })),
        ),
      }
    : null;
  return (
    <FilesView
      files={files}
      states={readFileStates(searchOf(search))}
      types={askableTypes(getDictionary(locale).applicantFile.types, types)}
      origin={SITE_URL}
      workspace={
        set && plan && counts
          ? {
              set,
              tags: tags.map(asTag),
              system: views.system,
              saved: [...views.workspace, ...views.mine],
              resolved,
              plan,
              counts,
            }
          : undefined
      }
    />
  );
}
