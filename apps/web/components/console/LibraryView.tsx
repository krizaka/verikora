"use client";

import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { CardGrid } from "@krizaka/ui/card-grid";
import { Chip } from "@krizaka/ui/chip";
import { EmptyState } from "@krizaka/ui/empty-state";
import { LinkCard } from "@krizaka/ui/link-card";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import { type Audience, type DocumentSummary, type Jurisdiction } from "@yomizaka/core";
import Link from "next/link";

import type { CheckSummary } from "@/lib/checks";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { libraryScreen } from "@/lib/library-screen";
import { collectionLabel } from "@/lib/organisation/display";
import { libraryPath } from "@/lib/organisation/rules";
import type { LibraryOverview } from "@/lib/organisation/store";
import { pluralKey } from "@/lib/plural";

import { CollectionMark } from "./CollectionMark";
import { DocumentTable, STATUS_TONE } from "./DocumentTable";
import { formatDate } from "./format";
import { LibraryDrop } from "./LibraryDrop";
import { CreateButton, ItemMenu, type TagOption } from "./OrganisationActions";
import { TagChips } from "./TagChips";

export type ExampleDocuments = Record<"tenant" | "landlord", { title: string; filename: string; text: string }>;

/**
 * The library's first screen (ADR-0007, the UX review's Y3): the page's `h1` with its secondary actions (the one primary,
 * « Vérifier un document », is the header's); what was checked last; the collections as cards with a place mark, their count
 * and their last check; the recent documents. A file dropped anywhere on the page is checked (`LibraryDrop`). With nothing
 * yet: the owl, one sentence, the only drop zone, and two examples.
 */
export function LibraryView({ libraries, recents, latest = [], tags, perspective = null, screening = false, examples, jurisdictions = ["QC"] }: { libraries: LibraryOverview[]; recents: DocumentSummary[]; latest?: CheckSummary[]; tags: TagOption[]; perspective?: Audience | null; screening?: boolean; examples?: ExampleDocuments; jurisdictions?: readonly Jurisdiction[] }) {
  const { say, locale } = useSay();
  const collections = libraries.flatMap((l) => l.collections);
  const screen = libraryScreen({ documents: recents.length, screening });
  // The teaching empty state only when there is nothing at all: a collection the person made stays reachable, documents or not.
  const nothingYet = screen.emptyDropzone && collections.every((c) => c.isDefault && c.files === 0);
  const order = (perspective === "landlord" ? ["landlord", "tenant"] : ["tenant", "landlord"]) as ("tenant" | "landlord")[];
  const first = libraries[0];
  const mine = say("organisation.defaultName");
  const labelOf = (c: { name: string; isDefault: boolean }) => collectionLabel(c.name, c.isDefault, mine);
  const destinations = collections.map((c) => ({ id: c.id, name: labelOf(c), avatar: c.avatar }));
  const header = (
    <PageHeader
      title={say("shell.titles.library")}
      description={say("library.lead")}
      actions={
        <span className="flex flex-wrap items-center gap-3" data-testid="library-actions">
          {first ? <CreateButton kind="collection" parentId={first.id} /> : null}
          {screen.secondary ? (
            <Button asChild variant="secondary" size="md">
              <Link href={`/${locale}${screen.secondary}`}>{say("library.screeningCta")}</Link>
            </Button>
          ) : null}
        </span>
      }
    />
  );
  if (nothingYet) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-5" aria-label={say("library.emptyTitle")} data-testid="library-empty">
          <EmptyState icon={<Mascot bird="owl" mood="welcome" size={120} />} title={say("library.emptyTitle")} description={say("library.emptyPitch")} />
          <LibraryDrop
            zone
            jurisdictions={jurisdictions}
            examples={(add) =>
              examples ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="library-examples">
                  <span className="text-sm text-fg-secondary">{say("library.tryExamples")}</span>
                  {order.map((role) => (
                    <Chip key={role} size="sm" selected={false} onClick={() => add([new File([examples[role].text], examples[role].filename, { type: "text/plain" })])}>
                      {say(role === "tenant" ? "library.exampleTenant" : "library.exampleLandlord")}
                    </Chip>
                  ))}
                  <span className="text-xs text-fg-muted">{say("library.examplesNote")}</span>
                </div>
              ) : null
            }
          />
        </section>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {header}
      <LibraryDrop jurisdictions={jurisdictions} />

      <section className="flex flex-col gap-3" aria-label={say("organisation.latestChecks")} data-testid="latest-checks">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-lg font-bold text-fg">{say("organisation.latestChecks")}</h2>
          {latest.length ? (
            <Link href={`/${locale}${CONSOLE_ROUTES.checks}`} className="text-sm font-semibold text-fg-accent hover:underline">
              {say("organisation.seeAll")} →
            </Link>
          ) : null}
        </div>
        {latest.length === 0 ? (
          <p className="m-0 text-sm text-fg-secondary">{say("organisation.noChecks")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border-default rounded-lg border border-border-default p-0">
            {latest.map((c) => (
              <li key={c.id}>
                <Link href={`/${locale}/app/documents/${c.documentId}/verifications`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-surface-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[c.result]} dot size="sm">
                      {say(`statuses.${c.result}`)}
                    </Badge>
                    <span className="min-w-0 break-words font-semibold text-fg">{c.title}</span>
                  </span>
                  <span className="text-xs text-fg-muted">
                    {say(`kinds.${c.kind}`)} · {formatDate(c.at, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {libraries.map((lib) => (
        <section key={lib.id} className="flex flex-col gap-3" aria-label={lib.name} data-testid="library-section">
          <h2 className="m-0 font-display text-lg font-bold text-fg">{libraries.length > 1 ? lib.name : say("organisation.collections")}</h2>
          {lib.collections.length === 0 ? <p className="m-0 text-sm text-fg-secondary">{say("organisation.noCollections")}</p> : null}
          <CardGrid as="ul" min={260} reveal={false}>
            {lib.collections.map((c) => (
              <div key={c.id} className="relative h-full" data-testid="collection-card">
                <LinkCard
                  href={libraryPath(locale, lib.id, c.id)}
                  linkAs={Link}
                  className="h-full pr-12"
                  icon={<CollectionMark id={c.id} name={labelOf(c)} avatar={c.avatar} />}
                  title={labelOf(c)}
                  meta={c.isDefault ? say("organisation.default") : undefined}
                  description={`${say(pluralKey("organisation.files", c.files), { count: c.files })}${c.folders > 0 ? ` · ${say(pluralKey("organisation.folders", c.folders), { count: c.folders })}` : ""}`}
                  extra={
                    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary" data-testid="collection-last-check">
                      {c.lastCheck ? (
                        <>
                          <Badge tone={STATUS_TONE[c.lastCheck.status]} size="sm">
                            {say(`statuses.${c.lastCheck.status}`)}
                          </Badge>
                          <span>{say("organisation.lastCheck", { date: formatDate(c.lastCheck.at, locale) })}</span>
                        </>
                      ) : (
                        <span>{say("organisation.neverChecked")}</span>
                      )}
                      <TagChips tags={c.tags} />
                    </div>
                  }
                />
                {/* The card is one link; its menu sits beside it, over the corner, never inside the anchor. */}
                <span className="absolute right-2 top-2">
                  <ItemMenu kind="collection" id={c.id} name={labelOf(c)} avatar={c.avatar} isDefault={c.isDefault} collections={destinations} tags={tags} current={c.tags.map((t) => t.id)} />
                </span>
              </div>
            ))}
          </CardGrid>
        </section>
      ))}

      {recents.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label={say("organisation.recents")}>
          <h2 className="m-0 font-display text-lg font-bold text-fg">{say("organisation.recents")}</h2>
          <DocumentTable rows={recents} />
        </section>
      ) : null}
    </div>
  );
}
