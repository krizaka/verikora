import { ChipLink } from "@krizaka/ui/chip-link";
import { EmptyState } from "@krizaka/ui/empty-state";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import { type CollectionAvatar as CollectionAvatarData, type DocumentSummary, type Jurisdiction } from "@verikora/core";
import Link from "next/link";

import { CollectionMark } from "@/components/console/CollectionMark";
import { DocumentTable } from "@/components/console/DocumentTable";
import { AddFilesButton, DropZone, LibraryDrop } from "@/components/console/LibraryDrop";
import { CreateButton, ItemMenu } from "@/components/console/OrganisationActions";
import { PlaceFilters } from "@/components/console/PlaceFilters";
import type { Messages } from "@/lib/i18n";
import { libraryPath, movedFolderHrefs, type ViewState } from "@/lib/organisation/rules";
import type { Folder, Tag } from "@/lib/organisation/store";
import { countLabel } from "@/lib/plural";

type Say = Messages["console"]["organisation"];

/**
 * A collection or one of its folders (the UX review's Y7): the breadcrumb, a header that says where this is (the place mark, the
 * name), what is here (the counts) and what can be done (add documents, a folder, the ⋯ menu of the place — a folder's on the
 * folder's page); the folders as a row of chips; the tags as a filter bar (`?tags=`); the files; and the whole page as a drop
 * zone that files into this place (the only zone is the empty place's). Rendered on the server; the actions are client islands.
 */
export function PlaceView({
  locale,
  t,
  library,
  collection,
  folder,
  folders,
  documents,
  tags,
  documentTags,
  view,
  tagsByDocument,
  folderTags,
  collections,
  collectionTags,
  path,
  jurisdictions,
}: Readonly<{
  locale: "en" | "fr";
  t: Say;
  library: { id: string; name: string };
  collection: { id: string; name: string; isDefault: boolean; avatar: CollectionAvatarData | null };
  folder?: { id: string; name: string };
  folders: (Folder & { files: number; tags: Tag[] })[];
  documents: DocumentSummary[];
  /** The first layer's tags: a collection's and a folder's. */
  tags: Tag[];
  /** The workspace's tags of kind « document »: the filter bar's and the rows'. */
  documentTags: Tag[];
  view: ViewState;
  tagsByDocument: Record<string, Tag[]>;
  folderTags?: Record<string, string[]>;
  collections: { id: string; name: string; avatar: CollectionAvatarData | null; libraryId?: string }[];
  collectionTags: string[];
  path: string;
  /** The jurisdictions the account is offered: a dropped file is checked at once only when one is possible (Y4). */
  jurisdictions?: readonly Jurisdiction[];
}>) {
  const crumbs = [
    { href: `/${locale}/app`, label: t.library },
    {
      href: libraryPath(locale, library.id, collection.id),
      label: collection.name,
      avatar: (
        <CollectionMark
          key="crumb-avatar"
          id={collection.id}
          name={collection.name}
          avatar={collection.avatar}
          size="sm"
        />
      ),
    },
    ...(folder ? [{ href: libraryPath(locale, library.id, collection.id, folder.id), label: folder.name }] : []),
  ];
  const counts = [
    ...(folder ? [] : [countLabel(t, "folders", folders.length)]),
    countLabel(t, "files", documents.length),
  ].join(" · ");
  const folderOptions = folders.map((f) => ({ id: f.id, name: f.name }));
  return (
    <LibraryDrop
      placement={{ collectionId: collection.id, folderId: folder?.id ?? null }}
      jurisdictions={jurisdictions}
    >
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={
            <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
              {crumbs.map((c, i) => (
                <span key={c.href} className="flex items-center gap-2">
                  {i > 0 ? <span aria-hidden>/</span> : null}
                  {"avatar" in c ? c.avatar : null}
                  {i === crumbs.length - 1 ? (
                    <span aria-current="page" className="font-semibold text-fg">
                      {c.label}
                    </span>
                  ) : (
                    <Link href={c.href} className="hover:text-fg-accent hover:underline">
                      {c.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          }
          title={
            <span className="flex items-center gap-3">
              <CollectionMark id={collection.id} name={collection.name} avatar={collection.avatar} />
              {folder?.name ?? collection.name}
            </span>
          }
          description={counts}
          actions={
            <>
              <AddFilesButton>{t.addDocuments}</AddFilesButton>
              {folder ? (
                <ItemMenu
                  kind="folder"
                  id={folder.id}
                  name={folder.name}
                  collections={collections}
                  folders={folderOptions}
                  tags={tags}
                  current={folderTags?.[folder.id] ?? []}
                  collectionId={collection.id}
                  afterDelete={libraryPath(locale, library.id, collection.id)}
                  afterMove={movedFolderHrefs(locale, collections, folder.id)}
                />
              ) : (
                <>
                  <CreateButton kind="folder" parentId={collection.id} variant="ghost" />
                  <ItemMenu
                    kind="collection"
                    id={collection.id}
                    name={collection.name}
                    avatar={collection.avatar}
                    isDefault={collection.isDefault}
                    collections={collections}
                    tags={tags}
                    current={collectionTags}
                  />
                </>
              )}
            </>
          }
        />
        {!folder && folders.length > 0 ? (
          <nav aria-label={t.foldersIn} className="flex flex-wrap items-center gap-2" data-testid="folder-chips">
            {folders.map((f) => (
              <ChipLink key={f.id} asChild size="sm" selected={false}>
                <Link href={libraryPath(locale, library.id, collection.id, f.id)}>
                  {f.name} · {countLabel(t, "files", f.files)}
                </Link>
              </ChipLink>
            ))}
          </nav>
        ) : null}
        {documentTags.length > 0 ? (
          <PlaceFilters tags={documentTags} selected={view.tags} path={path} view={view} count={documents.length} />
        ) : null}
        <section aria-label={t.filesIn} className="flex flex-col gap-3">
          {documents.length > 0 ? (
            <DocumentTable
              rows={documents}
              organise={{
                collections,
                folders: folderOptions,
                collectionId: collection.id,
                tags: documentTags,
                tagsByDocument,
              }}
            />
          ) : (
            <EmptyState
              icon={<Mascot bird="owl" mood="empty" size={96} />}
              title={t.emptyCollection}
              action={<DropZone />}
              data-testid="place-empty"
            />
          )}
        </section>
      </div>
    </LibraryDrop>
  );
}
