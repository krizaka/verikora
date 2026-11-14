import { notFound, redirect } from "next/navigation";

import { systemClock } from "@/app/system-clock";
import { PlaceView } from "@/components/console/PlaceView";
import { pageSession } from "@/lib/access";
import { query } from "@/lib/db";
import { documentsByIds } from "@/lib/documents";
import { appEnvironment } from "@/lib/env";
import { availableFlows, offerFor } from "@/lib/flows";
import { asLocale, getDictionary } from "@/lib/i18n";
import { isId, libraryPath, parseLibraryView } from "@/lib/organisation/rules";
import * as org from "@/lib/organisation/store";
import { KIND } from "@/lib/workspace/decl";
import { workspaceFor } from "@/lib/workspace/service";
import { asTag, asTags } from "@/lib/workspace/tags";

type Props = {
  params: Promise<{ locale: string; library?: string; collection?: string; folder?: string }>;
  searchParams: Promise<{ tags?: string | string[]; kind?: string; status?: string }>;
};

/** A collection or a folder, read on the server from the URL: `/app/library/[library]/[collection]/[folder]?tags=`. */
export async function PlacePage({ params, searchParams }: Readonly<Props>) {
  const p = await params;
  const locale = asLocale(p.locale);
  const session = await pageSession();
  if (!session) redirect(`/${locale}/sign-in`);
  const owner = session.account.id;
  const view = parseLibraryView(await searchParams);
  const selected = view.tags;
  const dict = getDictionary(locale).console;
  const t = dict.organisation;
  const tags = await org.listTags(query, owner);
  // A document's tags are the workspace's (verikora#324): markers, the ALL-tags filter. A collection's and a folder's stay the first layer's.
  const workspace = workspaceFor({ clock: systemClock });
  const documentTags = (await workspace.tags.list(owner, KIND.document)).map(asTag);
  const overview = await org.overview(query, owner);
  const collections = overview.flatMap((l) =>
    l.collections.map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, libraryId: l.id })),
  );
  // The account's offer: a dropped file is checked at once only when one jurisdiction is possible (Y4), as on the library's home.
  const jurisdictions = offerFor(await availableFlows(appEnvironment()), session.account.perspective).jurisdictions;

  if (!isId(p.library) || !isId(p.collection)) notFound();
  const collection = await org.ownedCollection(query, owner, p.collection).catch(() => null);
  if (!collection || collection.library_id !== p.library) notFound();
  const folder = p.folder ? await org.ownedFolder(query, owner, p.folder).catch(() => null) : undefined;
  if (p.folder && folder?.collection_id !== collection.id) notFound();
  const folders = await org.foldersOf(query, owner, collection.id);
  const ids = (await org.browse(query, owner, { collectionId: collection.id, folderId: folder?.id, tagIds: selected }))
    .documentIds;
  const documents = await documentsByIds(owner, ids);
  const byDoc = asTags(await workspace.tags.of(owner, KIND.document, ids));
  const collTags = await org.tagsOf(query, owner, "collection", [collection.id]);
  const lib = overview.find((l) => l.id === collection.library_id);
  if (!lib) notFound();
  return (
    <PlaceView
      locale={locale}
      t={t}
      library={{ id: lib.id, name: lib.name }}
      collection={{
        id: collection.id,
        name: collection.name,
        isDefault: collection.is_default,
        avatar: collection.avatar,
      }}
      folder={folder ? { id: folder.id, name: folder.name } : undefined}
      folders={folders}
      documents={documents}
      tags={tags}
      documentTags={documentTags}
      view={view}
      jurisdictions={jurisdictions}
      tagsByDocument={byDoc}
      folderTags={Object.fromEntries(folders.map((f) => [f.id, f.tags.map((x) => x.id)]))}
      collections={collections}
      collectionTags={(collTags.get(collection.id) ?? []).map((x) => x.id)}
      path={libraryPath(locale, lib.id, collection.id, folder?.id)}
    />
  );
}
