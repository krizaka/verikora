import { describe, expect, it } from "vitest";

import type { FileSummary } from "./applicant-file";
import type { CheckSummary } from "./checks";
import { HOME_ROWS, latestChecksOf, toTreatOf } from "./home-todo";

const file = (id: string, patch: Partial<FileSummary> = {}): FileSummary => ({
  id,
  candidateName: `Candidat ${id}`,
  status: "used",
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: "2026-12-01T10:00:00.000Z",
  submittedAt: "2026-10-10T10:00:00.000Z",
  closedAt: null,
  documents: 2,
  requested: 2,
  decision: "to_decide",
  tagIds: [],
  ...patch,
});
const check = (id: string, patch: Partial<CheckSummary> = {}): CheckSummary => ({
  id,
  documentId: `d-${id}`,
  title: `Doc ${id}`,
  kind: "lease",
  studio: "compliance-check",
  result: "attention",
  runId: null,
  at: "2026-10-12T10:00:00.000Z",
  ...patch,
});

describe("toTreatOf", () => {
  it("keeps the files sent and not decided, and the checks to look at; nothing else", () => {
    const rows = toTreatOf(
      [file("f1"), file("f2", { status: "closed" }), file("f3", { status: "open" })],
      [
        check("a1"),
        check("a2", { result: "checked" }),
        check("a3", { result: "failed" }),
        check("a4", { result: "analysing" }),
      ],
      "fr",
    );
    expect(rows.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(["check:a1", "check:a3", "file:f1"]);
  });

  it("sorts newest first, caps at five and links to what needs a decision", () => {
    const rows = toTreatOf(
      [file("f1", { submittedAt: "2026-10-30T10:00:00.000Z" })],
      Array.from({ length: 8 }, (_, i) => check(`a${i}`, { at: `2026-10-0${i + 1}T10:00:00.000Z` })),
      "en",
    );
    expect(rows).toHaveLength(HOME_ROWS);
    expect(rows[0]).toMatchObject({ kind: "file", href: "/en/app/dossiers/f1" });
    expect(rows[1]).toMatchObject({ kind: "check", href: "/en/app/documents/d-a7/rapport" });
  });

  it("is empty when nothing waits", () => {
    expect(toTreatOf([], [check("a1", { result: "checked" })], "fr")).toEqual([]);
  });
});

describe("latestChecksOf", () => {
  it("is the newest five, whatever the input order", () => {
    const input = Array.from({ length: 7 }, (_, i) => check(`a${i}`, { at: `2026-10-0${i + 1}T10:00:00.000Z` }));
    expect(latestChecksOf([...input].reverse()).map((c) => c.id)).toEqual(["a6", "a5", "a4", "a3", "a2"]);
    expect(latestChecksOf([])).toEqual([]);
  });
});
