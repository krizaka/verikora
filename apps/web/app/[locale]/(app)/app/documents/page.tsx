import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { systemClock } from "@/app/system-clock";
import { AllDocuments } from "@/components/console/AllDocuments";
import { pageSession } from "@/lib/access";
import { query } from "@/lib/db";
import { documentsByIds } from "@/lib/documents";
import { asLocale, getDictionary } from "@/lib/i18n";
import { dividers, knownBookmarks, wearingAll } from "@/lib/organisation/bookmarks";
import { parseLibraryView } from "@/lib/organisation/rules";
import { recentIds } from "@/lib/organisation/store";
import { KIND } from "@/lib/workspace/decl";
import { workspaceFor } from "@/lib/workspace/service";
import { asTag, asTags } from "@/lib/workspace/tags";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return { title: getDictionary(asLocale((await params).locale)).console.meta.documents };
}

// @fixed: the most the page loads at once; the table pages and filters them on the client, and ⌘K reaches the rest.
const MOST_DOCUMENTS = 500;

/** « Documents » (B2, P14): every document of the account, newest first, whatever its collection — the library's « Tous les documents » view. */
export default async function DocumentsPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ locale: string }>; searchParams: Promise<{ tags?: string | string[] }> }>) {
  const session = await pageSession();
  if (!session) notFound();
  const owner = session.account.id;
  const locale = asLocale((await params).locale);
  // The bookmarks are the workspace's tags of kind « document » (verikora#339); `?tags=` is the filter, every one asked for must be worn.
  const workspace = workspaceFor({ clock: systemClock });
  const bookmarks = (await workspace.tags.list(owner, KIND.document)).map(asTag);
  const selected = knownBookmarks(parseLibraryView(await searchParams).tags, bookmarks);
  const recent = await recentIds(query, owner, MOST_DOCUMENTS);
  const byDocument = asTags(await workspace.tags.of(owner, KIND.document, recent));
  const path = `/${locale}/app/documents`;
  const documents = await documentsByIds(owner, wearingAll(recent, byDocument, selected));
  return (
    <AllDocuments
      documents={documents}
      bookmarks={bookmarks}
      selected={selected}
      bookmarksByDocument={byDocument}
      path={path}
      tabs={dividers({ bookmarks, ids: recent, tagsByDocument: byDocument, selected, path })}
    />
  );
}
