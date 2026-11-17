import { describe, expect, it } from "vitest";

import type { FileSummary } from "./applicant-file";
import { dossiersOf } from "./home-dossiers";
import type { LibraryOverview } from "./organisation/store";

const col = (
  id: string,
  name: string,
  lastAt: string | null,
  files = 2,
  tags: { id: string; name: string; color: string }[] = [],
) => ({
  id,
  name,
  files,
  folders: 0,
  tags,
  isDefault: false,
  avatar: null,
  description: null,
  lastCheck: lastAt ? { at: lastAt, status: "checked" as const } : null,
});
const libs = (...collections: ReturnType<typeof col>[]) =>
  [{ id: "l1", name: "L", collections }] as unknown as LibraryOverview[];
const file = (id: string, name: string, at: string) =>
  ({ id, candidateName: name, status: "used", createdAt: at, submittedAt: null, documents: 3 }) as FileSummary;

describe("dossiersOf", () => {
  it("merges collections and applicant files, the latest activity first, a never-checked collection last by name", () => {
    const rows = dossiersOf(
      libs(col("c1", "Zeta", null), col("c2", "Alpha", null), col("c3", "Laurier", "2026-10-20T10:00:00.000Z")),
      [file("f1", "Camille", "2026-10-25T10:00:00.000Z")],
      "fr",
      "Mes documents",
    );
    expect(rows.map((r) => r.name)).toEqual(["Camille", "Laurier", "Alpha", "Zeta"]);
  });

  it("gives each row the address that opens it, with the language", () => {
    const rows = dossiersOf(libs(col("c1", "A", null)), [file("f1", "B", "2026-10-25T10:00:00.000Z")], "en", "My");
    expect(rows.map((r) => r.href)).toEqual(["/en/app/dossiers/f1", "/en/app/library/l1/c1"]);
  });

  it("carries a collection's tags, two at most, with the count of the rest", () => {
    const tag = (id: string, color: string) => ({ id, name: `t-${id}`, color });
    const [row] = dossiersOf(
      libs(col("c1", "Rosemont", null, 2, [tag("a", "red"), tag("b", "blue"), tag("c", "green"), tag("d", "gray")])),
      [],
      "fr",
      "Mes documents",
    );
    expect(row).toMatchObject({ kind: "collection", tags: [tag("a", "red"), tag("b", "blue")], moreTags: 2 });
  });

  it("carries no tag and no count for a collection without tags", () => {
    const [row] = dossiersOf(libs(col("c1", "A", null)), [], "fr", "Mes documents");
    expect(row).toMatchObject({ tags: [], moreTags: 0 });
  });
});
