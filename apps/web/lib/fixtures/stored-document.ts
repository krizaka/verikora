/**
 * A stored document as GET /api/documents/:id returns it: one PDF lease, kept in the database in Canada.
 * Shared by the tests that need a document detail; `extra` adds or replaces fields (e.g. `insight`).
 */
export function storedDocument(extra: Record<string, unknown> = {}) {
  return {
    document: {
      id: "d1",
      title: "t",
      filename: "t.pdf",
      mimeType: "application/pdf",
      kind: "lease",
      sizeBytes: 1,
      pages: 1,
      hasText: true,
      status: "stored",
      createdAt: "2026-10-23T00:00:00.000Z",
      sha256: "a".repeat(64),
      text: "",
      analyses: [],
      storage: {
        kind: "database",
        endpoint: null,
        region: "ca",
        residency: "canada",
        encrypted: true,
        owner: "krizaka",
        devOnly: false,
      },
      retainUntil: null,
      purged: false,
      ...extra,
    },
  };
}
