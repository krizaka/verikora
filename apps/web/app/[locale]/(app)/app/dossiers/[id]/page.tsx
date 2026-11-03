import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { systemClock } from "@/app/system-clock";
import { ApplicantFilesNotOffered } from "@/components/console/ApplicantFilesNotOffered";
import { FileView } from "@/components/console/FileView";
import { pageSession } from "@/lib/access";
import { applicantFileOf, documentTypes } from "@/lib/applicant-file";
import { askableTypes } from "@/lib/applicant-file-face";
import { appEnvironment } from "@/lib/env";
import { applicantFilesOffered, availableFlows } from "@/lib/flows";
import { HttpError } from "@/lib/http";
import { asLocale, getDictionary } from "@/lib/i18n";
import { KIND } from "@/lib/workspace/decl";
import { workspaceFor } from "@/lib/workspace/service";
import { asTag } from "@/lib/workspace/tags";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.dossiers.title };
}

/** One applicant file — another account's file is a 404, never a 403; a person not offered the flow reads who it is for. */
export default async function FilePage({ params }: Readonly<{ params: Promise<{ locale: string; id: string }> }>) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  const session = await pageSession();
  if (!session) notFound();
  if (!applicantFilesOffered(await availableFlows(appEnvironment()), session.account.perspective ?? null))
    return <ApplicantFilesNotOffered locale={locale} />;
  const file = await applicantFileOf(session.account.id, id, new Date()).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  if (!file) notFound();
  const workspace = workspaceFor({ clock: systemClock });
  const owner = session.account.id;
  const [configuration, state, worn, tags] = await Promise.all([
    workspace.config.get(KIND.applicantFile),
    workspace.status.of(owner, KIND.applicantFile, [id]),
    workspace.tags.of(owner, KIND.applicantFile, [id]),
    workspace.tags.list(owner, KIND.applicantFile),
  ]);
  const set = configuration?.config.status ?? null;
  return (
    <FileView
      file={file}
      affordability={getDictionary(locale).affordability}
      types={askableTypes(getDictionary(locale).applicantFile.types, await documentTypes())}
      workspace={
        set
          ? {
              set,
              decision: state.get(id)?.state ?? set.initial ?? "",
              tags: tags.map(asTag),
              tagIds: (worn.get(id) ?? []).map((t) => t.id),
            }
          : undefined
      }
    />
  );
}
