"use client";

import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Chip } from "@krizaka/ui/chip";
import { EmptyState } from "@krizaka/ui/empty-state";
import { List } from "@krizaka/ui/list";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import { type Audience, type Jurisdiction } from "@verikora/core";
import Link from "next/link";

import type { FileSummary } from "@/lib/applicant-file";
import { checksTabHref, CONSOLE_ROUTES } from "@/lib/console-nav";
import { type CreditsFigure } from "@/lib/home-b2";
import { type DossierRow, dossiersOf } from "@/lib/home-dossiers";
import { useSay } from "@/lib/i18n-client";
import { libraryScreen } from "@/lib/library-screen";
import type { LibraryOverview } from "@/lib/organisation/store";
import { pluralKey } from "@/lib/plural";

import { STATUS_TONE } from "./DocumentTable";
import { formatDate } from "./format";
import { UsageLine } from "./HomeSections";
import { LibraryDrop } from "./LibraryDrop";
import { CreateButton } from "./OrganisationActions";

export type ExampleDocuments = Record<"tenant" | "landlord", { title: string; filename: string; text: string }>;

/**
 * The home (krizaka-internal#1898, the UX review of #1890): « Accueil », three blocks in the order of the two jobs —
 * « Vérifier un document » (the one primary action: the drop zone itself, so the drop on the home is the first step; a sticky
 * action on a phone once the zone has scrolled away), « Mes dossiers » (one list: the binder's collections and the applicant files,
 * each with the status of its last result, the whole row opens it) and the plan and usage as one discreet line. Activity and
 * sparklines are not here. A file dropped anywhere on the page is checked (`LibraryDrop`). With nothing yet: the owl, one
 * sentence, the only drop zone, and two examples.
 */
export function LibraryView({
  libraries,
  documents,
  files = [],
  perspective = null,
  screening = false,
  examples,
  jurisdictions = ["QC"],
  credits = null,
}: Readonly<{
  libraries: LibraryOverview[];
  documents: number;
  files?: readonly FileSummary[];
  perspective?: Audience | null;
  screening?: boolean;
  examples?: ExampleDocuments;
  jurisdictions?: readonly Jurisdiction[];
  credits?: CreditsFigure | null;
}>) {
  const { say, locale } = useSay();
  const collections = libraries.flatMap((l) => l.collections);
  const screen = libraryScreen({ documents, screening });
  // The teaching empty state only when there is nothing at all: a collection the person made stays reachable, documents or not.
  const nothingYet =
    screen.emptyDropzone && files.length === 0 && collections.every((c) => c.isDefault && c.files === 0);
  const order = (perspective === "landlord" ? ["landlord", "tenant"] : ["tenant", "landlord"]) as (
    "tenant" | "landlord"
  )[];
  const header = <PageHeader title={say("shell.titles.library")} description={say("home.check.lead")} />;
  if (nothingYet) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <LibraryEmpty jurisdictions={jurisdictions} examples={examples} order={order} credits={credits} />
      </div>
    );
  }
  const applicants = dossiersOf([], files, locale, "").slice(0, FILES_SHOWN);
  const documentRows = dossiersOf(libraries, [], locale, say("organisation.defaultName"));
  return (
    <div className="flex flex-col gap-8">
      {header}
      {screen.secondary ? <ApplicantFiles rows={applicants} total={files.length} /> : null}
      <DocumentsList rows={documentRows} firstId={libraries[0]?.id} />
      {credits ? <UsageLine figure={credits} /> : null}
      {/* Drop anywhere stays (the overlay); the page has no drop zone and no second primary: « Vérifier un document » is the header's. */}
      <LibraryDrop jurisdictions={jurisdictions} />
    </div>
  );
}

/** « Dossiers de candidats » (krizaka-internal#2290): the files waiting for a decision first, five at most, each row one tap from its file; asking for documents is the section's secondary action. */
function ApplicantFiles({ rows, total }: Readonly<{ rows: readonly DossierRow[]; total: number }>) {
  const { say, locale } = useSay();
  const base = `/${locale}${CONSOLE_ROUTES.files}`;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="home-files-title" data-testid="home-files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-files-title" className="m-0 font-display text-lg font-bold text-fg">
          {say("home.files.title")}
        </h2>
        <Button asChild variant="secondary" size="md">
          <Link href={base}>{say("dossiers.request")}</Link>
        </Button>
      </div>
      <List
        items={rows}
        getId={(r) => r.id}
        aria-label={say("home.files.label")}
        chevrons
        empty={<p className="m-0 text-sm text-fg-secondary">{say("home.files.empty")}</p>}
        row={(r) => ({
          title: r.name,
          href: r.href,
          description: received(r, say),
          meta: (
            <Badge tone={rowTone(r)} dot size="sm">
              {say(`dossiers.filter.states.${r.status}`)}
            </Badge>
          ),
        })}
      />
      {total > rows.length ? (
        <Link
          href={base}
          className="-my-3 inline-flex min-h-11 items-center self-start text-sm font-semibold text-fg-accent hover:underline"
        >
          {say("home.files.all")} →
        </Link>
      ) : null}
    </section>
  );
}

/** « Mes documents »: the binder's collections, compact (name, what it holds, the status of the last result); the batch import is a quiet link here. */
function DocumentsList({ rows, firstId }: Readonly<{ rows: readonly DossierRow[]; firstId?: string }>) {
  const { say, locale } = useSay();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="home-documents-title" data-testid="home-dossiers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-documents-title" className="m-0 font-display text-lg font-bold text-fg">
          {say("home.documents.title")}
        </h2>
        <span className="flex flex-wrap items-center gap-3">
          <Link
            href={checksTabHref(locale, "lots")}
            className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-fg-accent hover:underline"
            data-testid="home-import"
          >
            {say("home.check.import")}
          </Link>
          {firstId ? <CreateButton kind="collection" parentId={firstId} /> : null}
        </span>
      </div>
      <List
        items={rows}
        getId={(r) => r.id}
        aria-label={say("home.documents.label")}
        chevrons
        empty={<p className="m-0 text-sm text-fg-secondary">{say("home.dossiers.empty")}</p>}
        row={(r) => ({
          title: r.name,
          href: r.href,
          description: [
            say(pluralKey("organisation.files", r.count), { count: r.count }),
            r.at ? say("home.dossiers.moved", { date: formatDate(r.at, locale) }) : say("home.dossiers.never"),
          ].join(" · "),
          meta: r.status ? (
            <Badge tone={rowTone(r)} dot size="sm">
              {say(`statuses.${r.status}`)}
            </Badge>
          ) : undefined,
        })}
      />
    </section>
  );
}

/** « 2 sur 3 reçus »; nothing when no document was asked for. */
function received(r: DossierRow, say: ReturnType<typeof useSay>["say"]): string | undefined {
  if (!r.requested) {
    return undefined;
  }
  const key = r.count ? "dossiers.documents.some" : "dossiers.documents.none";
  return say(key, { count: r.count, asked: r.requested });
}

/** The most applicant files the home lists; the rest is « Voir tous les dossiers ». */
const FILES_SHOWN = 5;

const FILE_TONE = { open: "accent", used: "warning", closed: "success" } as const;
const rowTone = (r: DossierRow) =>
  r.kind === "collection"
    ? STATUS_TONE[r.status ?? "stored"]
    : ((FILE_TONE as Record<string, "accent" | "warning" | "success">)[r.status] ?? "neutral");

/** The two examples offered under the drop zone (a tenant's lease, a landlord's file): a chip each adds it to the drop. */
const examplesSlot = (
  examples: ExampleDocuments | undefined,
  order: readonly ("tenant" | "landlord")[],
  say: ReturnType<typeof useSay>["say"],
) =>
  function ExamplesSlot(add: (files: File[]) => void) {
    return examples ? (
      <div className="flex flex-wrap items-center gap-2" data-testid="library-examples">
        <span className="text-sm text-fg-secondary">{say("library.tryExamples")}</span>
        {order.map((role) => (
          <Chip
            key={role}
            size="sm"
            selected={false}
            onClick={() => add([new File([examples[role].text], examples[role].filename, { type: "text/plain" })])}
          >
            {say(role === "tenant" ? "library.exampleTenant" : "library.exampleLandlord")}
          </Chip>
        ))}
        <span className="text-xs text-fg-muted">{say("library.examplesNote")}</span>
      </div>
    ) : null;
  };

/** Nothing at all yet: the owl, one sentence, the only drop zone, and two examples. */
function LibraryEmpty({
  jurisdictions,
  examples,
  order,
  credits = null,
}: Readonly<{
  jurisdictions: readonly Jurisdiction[];
  examples?: ExampleDocuments;
  order: readonly ("tenant" | "landlord")[];
  credits?: CreditsFigure | null;
}>) {
  const { say, locale } = useSay();
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-5"
      aria-label={say("library.emptyTitle")}
      data-testid="library-empty"
    >
      <EmptyState
        icon={<Mascot bird="owl" mood="welcome" size={120} />}
        title={say("library.emptyTitle")}
        description={say("library.emptyPitch")}
      />
      <LibraryDrop zone jurisdictions={jurisdictions} examples={examplesSlot(examples, order, say)} />
      <p className="m-0 text-center text-sm text-fg-secondary" data-testid="library-empty-dossiers">
        {say("library.emptyDossiers")}
      </p>
      <p className="m-0 text-center text-sm">
        <Link
          href={`/${locale}#proof`}
          className="inline-flex min-h-11 items-center font-semibold text-fg-accent hover:underline"
          data-testid="library-sample-report"
        >
          {say("library.sampleReport")}
        </Link>
      </p>
      {credits ? <UsageLine figure={credits} /> : null}
    </section>
  );
}
