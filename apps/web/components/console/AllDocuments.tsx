"use client";

import { EmptyState } from "@krizaka/ui/empty-state";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import type { DocumentSummary } from "@verikora/core";

import { ButtonLink } from "@/components/ButtonLink";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import type { Divider } from "@/lib/organisation/bookmarks";
import type { Tag } from "@/lib/organisation/store";

import { BookmarkDividers } from "./BookmarkDividers";
import { DocumentTable } from "./DocumentTable";
import { PlaceFilters } from "./PlaceFilters";

/** « Documents » (B2, P14): every document, in the table the collections use — sortable, filterable, a row leading to its report. */
export function AllDocuments({
  documents,
  bookmarks = [],
  selected = [],
  bookmarksByDocument = {},
  path = "",
  tabs = [],
}: Readonly<{
  documents: DocumentSummary[];
  bookmarks?: Tag[];
  selected?: string[];
  bookmarksByDocument?: Record<string, Tag[]>;
  path?: string;
  tabs?: Divider[];
}>) {
  const { say, locale } = useSay();
  const nothing =
    selected.length > 0 ? (
      <p className="m-0 text-sm text-fg-secondary" data-testid="documents-nothing">
        {say("documentsPage.nothingWithBookmarks")}
      </p>
    ) : (
      <EmptyState
        icon={<Mascot bird="owl" mood="empty" size={96} />}
        title={say("documentsPage.empty")}
        action={
          <ButtonLink href={`/${locale}${CONSOLE_ROUTES.check}`} variant="primary" size="md">
            {say("shell.checkAction")}
          </ButtonLink>
        }
        data-testid="documents-empty"
      />
    );
  return (
    <div className="flex flex-col gap-6" data-testid="all-documents">
      <PageHeader title={say("documentsPage.title")} description={say("documentsPage.lead")} />
      {tabs.length > 1 ? <BookmarkDividers tabs={tabs} path={path} /> : null}
      {/* The bookmarks as a filter (verikora#339): the address is the state, `?tags=`, every bookmark asked for must be worn. */}
      {bookmarks.length > 0 ? (
        <PlaceFilters
          tags={bookmarks}
          selected={selected}
          path={path}
          view={{ tags: selected, kind: null, status: null }}
          count={documents.length}
        />
      ) : null}
      {documents.length ? (
        <DocumentTable
          rows={documents}
          caption={say("documentsPage.caption")}
          bookmarks={{ all: bookmarks, byDocument: bookmarksByDocument }}
        />
      ) : (
        nothing
      )}
    </div>
  );
}
