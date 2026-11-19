import type { FileSummary } from "./applicant-file";
import { collectionLabel } from "./organisation/display";
import { libraryPath } from "./organisation/rules";
import type { LibraryOverview, Tag } from "./organisation/store";

/** How many of a collection's tags the home row names; the rest is a « +N ». */
const HOME_TAGS_SHOWN = 2;

/**
 * « My dossiers » (krizaka-internal#1898): a dossier is a binder collection or an applicant file, one list for both, newest
 * activity first. The row carries what is read before opening it: its name, how much it holds, the status of its last result, and
 * when it last moved. Pure; the words come from the messages.
 */
export type DossierRow =
  | {
      kind: "collection";
      id: string;
      name: string;
      count: number;
      /** How many documents were asked for (applicant files only). */
      requested: number;
      status: "stored" | "analysing" | "checked" | "attention" | "blocking" | "failed" | null;
      at: string | null;
      href: string;
      /** The collection's first tags (at most `HOME_TAGS_SHOWN`) and how many more it wears. */
      tags: Tag[];
      moreTags: number;
    }
  | {
      kind: "applicantFile";
      id: string;
      name: string;
      count: number;
      requested: number;
      status: FileSummary["status"];
      at: string;
      href: string;
    };

/** The list of the home: collections and applicant files, the most recently moved first (a collection never checked comes after, by name). */
export function dossiersOf(
  libraries: readonly LibraryOverview[],
  files: readonly FileSummary[],
  locale: "en" | "fr",
  mine: string,
): DossierRow[] {
  const collections: DossierRow[] = libraries.flatMap((l) =>
    l.collections.map((c) => ({
      kind: "collection" as const,
      id: c.id,
      name: collectionLabel(c.name, c.isDefault, mine),
      count: c.files,
      requested: 0,
      status: c.lastCheck?.status ?? null,
      at: c.lastCheck?.at ?? null,
      href: libraryPath(locale, l.id, c.id),
      tags: c.tags.slice(0, HOME_TAGS_SHOWN),
      moreTags: Math.max(0, c.tags.length - HOME_TAGS_SHOWN),
    })),
  );
  const applicants: DossierRow[] = files.map((f) => ({
    kind: "applicantFile" as const,
    id: f.id,
    name: f.candidateName,
    count: f.documents,
    requested: f.requested,
    status: f.status,
    at: f.submittedAt ?? f.createdAt,
    href: `/${locale}/app/dossiers/${f.id}`,
  }));
  return [...collections, ...applicants].sort(
    (a, b) => (b.at ?? "").localeCompare(a.at ?? "") || a.name.localeCompare(b.name, locale),
  );
}
