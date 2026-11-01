import { BULK_MAX, filterSql } from "@krizaka/organize";
import { memoryStore } from "@yomizaka/core";
import { beforeAll, describe, expect, it } from "vitest";

import { countApplicantFiles, listApplicantFiles, requestApplicantFile } from "../applicant-file";
import { migrate, query } from "../db";
import { browse } from "../organisation/store";
import { binderPlan } from "./binder";
import { DECISION, KIND, WORKSPACE } from "./decl";
import { DECISION_SET } from "./defaults";
import { actorOf, seedWorkspace, workspaceFor } from "./service";

/** The organised workspace against a real PostgreSQL (CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…): yomizaka#324. Demo data only. */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-25T12:00:00Z");
const clock = { now: () => NOW };
const byText = (a: string, b: string) => a.localeCompare(b);

describe.runIf(enabled)("the organised workspace (yomizaka#324)", () => {
  const stamp = Date.now();
  const store = memoryStore({ kind: "s3" });
  let eric: { id: string; email: string };
  let stranger: { id: string; email: string };
  let seq = 0;

  const account = async (who: string) => {
    const email = `${who}-${stamp}@yomizaka.test`;
    const [row] = await query<{ id: string }>(
      "INSERT INTO accounts (email, audit_credits) VALUES ($1, 50) RETURNING id",
      [email],
    );
    return { id: row!.id, email };
  };
  const ws = (options: { store?: typeof store } = { store }) => workspaceFor({ clock, store: options.store });
  const file = async (owner = eric) =>
    (
      await requestApplicantFile(
        owner,
        { candidateName: "Camille Fictif", candidateEmail: `c${++seq}-${stamp}@exemple.test`, types: ["pay-stub"] },
        NOW,
      )
    ).id;
  /** A document of the file: kept in the database, or on the store (its object is there too). */
  const document = async (owner: { id: string }, fileId: string, where: "database" | "s3" = "database") => {
    const [row] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, screening_id, title, filename, mime_type, size_bytes, sha256, content, text, storage) VALUES ($1, $2, 't', 'f.pdf', 'application/pdf', 1, $3, 'x', 'texte', $4) RETURNING id",
      [owner.id, fileId, `${stamp}-${++seq}`, where],
    );
    if (where === "s3")
      await store.put(`${owner.id}/${row!.id}/original.pdf`, new Uint8Array([1]), { contentType: "application/pdf" });
    return row!.id;
  };
  const stateOf = async (id: string) => (await ws().status.of(eric.id, KIND.applicantFile, [id])).get(id)?.state;
  const trail = (id: string, action: string) =>
    query<{ detail: Record<string, unknown> }>("SELECT detail FROM audit_log WHERE target_id = $1 AND action = $2", [
      id,
      action,
    ]);
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return (error as { code?: string }).code ?? (error as { body?: { code?: string } }).body?.code ?? "error";
    }
    return "no error";
  };

  beforeAll(async () => {
    await migrate();
    await seedWorkspace(clock);
    eric = await account("eric");
    stranger = await account("stranger");
  });

  it("seeds the decision set once, in the database: seeding again keeps what the administration set", async () => {
    const stored = await ws().config.get(KIND.applicantFile);
    expect(stored?.config.status).toEqual(DECISION_SET);
    expect(await seedWorkspace(clock)).toEqual([]);
    expect((await ws().config.get(KIND.document))?.config.status).toBeNull();
  });

  it("decides a file: it closes with its link, its documents are purged from the database and the store, its reports stay, and the trail has one line", async () => {
    const id = await file();
    const kept = await document(eric, id);
    const onStore = await document(eric, id, "s3");
    await query(
      "INSERT INTO analyses (document_id, studio, status, run_id) VALUES ($1, 'compliance-check', 'succeeded', $2)",
      [kept, `run-${stamp}-1`],
    );
    const result = await ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, {
      ids: [id],
      to: DECISION.notSelected,
      expect: DECISION.toDecide,
    });
    expect(result.moved.map((m) => [m.entityId, m.to, m.final])).toEqual([[id, DECISION.notSelected, true]]);
    expect(await stateOf(id)).toBe(DECISION.notSelected);
    const [row] = await query<{ closed_at: Date | null; revoked_at: Date | null }>(
      "SELECT closed_at, revoked_at FROM screenings WHERE id = $1",
      [id],
    );
    expect(row?.closed_at).toEqual(NOW);
    expect(row?.revoked_at).toEqual(NOW);
    const docs = await query<{ storage: string; len: number; text: string }>(
      "SELECT storage, octet_length(content) AS len, text FROM documents WHERE screening_id = $1",
      [id],
    );
    expect(docs).toHaveLength(2);
    for (const d of docs) expect(d).toEqual({ storage: "none", len: 0, text: "" });
    expect(await store.get(`${eric.id}/${onStore}/original.pdf`)).toBeNull();
    expect(await query("SELECT id FROM analyses WHERE document_id = $1", [kept])).toHaveLength(1);
    const lines = await trail(id, "organize.status_changed");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.detail).toMatchObject({ from: DECISION.toDecide, to: DECISION.notSelected, final: true });
    expect((await trail(id, "applicant_file.closed"))[0]!.detail).toMatchObject({
      purged: 2,
      decision: DECISION.notSelected,
    });
  });

  it("decides many at once: one audit line per file, and the file already decided is skipped, named", async () => {
    const [a, b, c] = [await file(), await file(), await file()];
    await ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [a!], to: DECISION.selected });
    const result = await ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, {
      ids: [a!, b!, c!],
      to: DECISION.selected,
    });
    expect(result.moved.map((m) => m.entityId).sort(byText)).toEqual([b!, c!].sort(byText));
    expect(result.skipped).toEqual([{ id: a, code: "ALREADY" }]);
    for (const id of [a!, b!, c!]) expect(await trail(id, "organize.status_changed")).toHaveLength(1);
  });

  it("decides in one transaction: when a kept file's store is missing, nothing is decided, closed, purged or recorded", async () => {
    const [a, b] = [await file(), await file()];
    await document(eric, a!);
    await document(eric, b!, "s3");
    await expect(
      ws({ store: undefined }).status.move(eric.id, actorOf(eric), KIND.applicantFile, {
        ids: [a!, b!],
        to: DECISION.selected,
      }),
    ).rejects.toMatchObject({ status: 409, body: { code: "STORAGE_UNAVAILABLE" } });
    for (const id of [a!, b!]) {
      expect(await stateOf(id)).toBe(DECISION.toDecide);
      expect(await trail(id, "organize.status_changed")).toHaveLength(0);
      expect(await trail(id, "applicant_file.closed")).toHaveLength(0);
    }
    const [open] = await query<{ closed_at: Date | null }>("SELECT closed_at FROM screenings WHERE id = $1", [a]);
    expect(open?.closed_at).toBeNull();
    const [kept] = await query<{ len: number }>(
      "SELECT octet_length(content) AS len FROM documents WHERE screening_id = $1",
      [a],
    );
    expect(kept?.len).toBe(1);
  });

  it("two people deciding the same file at once give one decision and one refusal", async () => {
    const id = await file();
    const targets = [
      DECISION.selected,
      DECISION.notSelected,
      DECISION.selected,
      DECISION.notSelected,
      DECISION.selected,
      DECISION.notSelected,
    ];
    const outcomes = await Promise.all(
      targets.map((to) =>
        codeOf(
          ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [id], to, expect: DECISION.toDecide }),
        ),
      ),
    );
    expect(outcomes.filter((o) => o === "no error")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "STALE")).toHaveLength(outcomes.length - 1);
    expect(await trail(id, "organize.status_changed")).toHaveLength(1);
    expect(await trail(id, "applicant_file.closed")).toHaveLength(1);
  });

  it("two people deciding the same file at once, without having looked, still give one decision", async () => {
    const id = await file();
    const outcomes = await Promise.all(
      [DECISION.selected, DECISION.notSelected].map((to) =>
        codeOf(ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [id], to })),
      ),
    );
    expect(outcomes.filter((o) => o === "no error")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "MOVE_NOT_ALLOWED")).toHaveLength(1);
    expect(await trail(id, "organize.status_changed")).toHaveLength(1);
  });

  it("answers 404 for another account's file, in one id or among others, and decides nothing", async () => {
    const mine = await file();
    const theirs = await file(stranger);
    expect(
      await codeOf(
        ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [theirs], to: DECISION.selected }),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(
        ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [mine, theirs], to: DECISION.selected }),
      ),
    ).toBe("NOT_FOUND");
    expect(await stateOf(mine)).toBe(DECISION.toDecide);
    const [still] = await query<{ closed_at: Date | null }>("SELECT closed_at FROM screenings WHERE id = $1", [theirs]);
    expect(still?.closed_at).toBeNull();
  });

  it("does not take an ordinary screening as an applicant file: only flow « file » is the scope's", async () => {
    const [row] = await query<{ id: string }>(
      "INSERT INTO screenings (landlord_id, tenant_name, tenant_email, provider, token_hash, expires_at) VALUES ($1, 'S', $2, 'x', $3, now() + interval '1 day') RETURNING id",
      [eric.id, `s-${stamp}@exemple.test`, `h-${stamp}`],
    );
    expect(
      await codeOf(
        ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [row!.id], to: DECISION.selected }),
      ),
    ).toBe("NOT_FOUND");
  });

  it(`takes at most ${BULK_MAX} files a call`, async () => {
    const ids = Array.from({ length: BULK_MAX + 1 }, () => crypto.randomUUID());
    expect(
      await codeOf(ws().status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids, to: DECISION.selected })),
    ).toBe("TOO_MANY");
  });

  it("tags files in bulk with a marker, one audit line per file, and keeps a foreign tag out", async () => {
    const [a, b] = [await file(), await file()];
    const w = ws();
    const garant = await w.tags.create(eric.id, actorOf(eric), KIND.applicantFile, {
      name: `Garant ${stamp}`,
      marker: "amber",
    });
    expect(garant.marker).toBe("amber");
    expect(await w.tags.apply(eric.id, actorOf(eric), KIND.applicantFile, { ids: [a!, b!], add: [garant.id] })).toBe(2);
    for (const id of [a!, b!]) expect(await trail(id, "organize.tags_changed")).toHaveLength(1);
    const theirs = await ws().tags.create(stranger.id, actorOf(stranger), KIND.applicantFile, {
      name: `Autre ${stamp}`,
      marker: "red",
    });
    expect(
      await codeOf(w.tags.apply(eric.id, actorOf(eric), KIND.applicantFile, { ids: [a!], add: [theirs.id] })),
    ).toBe("NOT_FOUND");
  });

  it("filters the files on ALL the tags worn, and on the decision, from the address", async () => {
    const [both, one, none] = [await file(), await file(), await file()];
    const w = ws();
    const x = await w.tags.create(eric.id, actorOf(eric), KIND.applicantFile, { name: `X ${stamp}`, marker: "blue" });
    const y = await w.tags.create(eric.id, actorOf(eric), KIND.applicantFile, { name: `Y ${stamp}`, marker: "violet" });
    await w.tags.apply(eric.id, actorOf(eric), KIND.applicantFile, { ids: [both!, one!], add: [x.id] });
    await w.tags.apply(eric.id, actorOf(eric), KIND.applicantFile, { ids: [both!], add: [y.id] });
    const idsOf = async (organised: Parameters<typeof listApplicantFiles>[2]) =>
      (await listApplicantFiles(eric.id, NOW, organised)).map((f) => f.id);
    expect(await idsOf({ filters: { tags: [x.id, y.id] }, set: DECISION_SET })).toEqual([both]);
    expect((await idsOf({ filters: { tags: [x.id] }, set: DECISION_SET })).sort(byText)).toEqual(
      [both!, one!].sort(byText),
    );
    await w.status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [one!], to: DECISION.selected });
    expect(await idsOf({ filters: { tags: [x.id], status: [DECISION.selected] }, set: DECISION_SET })).toEqual([one]);
    expect(await idsOf({ filters: { tags: [x.id], status: [DECISION.toDecide] }, set: DECISION_SET })).toEqual([both]);
    expect(await idsOf({ filters: { status: [DECISION.toDecide] }, set: DECISION_SET })).toContain(none);
    const listed = (await listApplicantFiles(eric.id, NOW, { set: DECISION_SET })).find((f) => f.id === both);
    expect(listed).toMatchObject({ decision: DECISION.toDecide, tagIds: expect.arrayContaining([x.id, y.id]) });
  });

  it("counts the binder's tabs and chips with the list's own filter: each count is the length of its view (yomizaka#334)", async () => {
    const [a, b, c] = [await file(), await file(), await file()];
    const w = ws();
    const t = await w.tags.create(eric.id, actorOf(eric), KIND.applicantFile, {
      name: `Binder ${stamp}`,
      marker: "green",
    });
    await w.tags.apply(eric.id, actorOf(eric), KIND.applicantFile, { ids: [a!, b!], add: [t.id] });
    await w.status.move(eric.id, actorOf(eric), KIND.applicantFile, { ids: [b!], to: DECISION.selected });
    expect(c).toBeTruthy();
    const plan = binderPlan(DECISION_SET, [t.id], { tags: [t.id] });
    for (const tab of plan.tabs)
      expect(await countApplicantFiles(eric.id, { filters: tab.filters, set: DECISION_SET })).toBe(
        (await listApplicantFiles(eric.id, NOW, { filters: tab.filters, set: DECISION_SET })).length,
      );
    expect(await countApplicantFiles(eric.id, { filters: plan.tabs[0]!.filters, set: DECISION_SET })).toBe(2);
    expect(await countApplicantFiles(eric.id, { filters: plan.tabs[2]!.filters, set: DECISION_SET })).toBe(1);
    expect(await countApplicantFiles(eric.id, { filters: plan.chips[0]!.countFilters, set: DECISION_SET })).toBe(2);
  });

  it("filters the documents of a collection on ALL their tags, with the layer's filter (it replaces allTagsClause)", async () => {
    const w = ws();
    const [col] = await query<{ id: string }>("SELECT id FROM collections WHERE owner_id = $1 AND is_default", [
      eric.id,
    ]);
    const doc = async () =>
      (
        await query<{ id: string }>(
          "INSERT INTO documents (owner_id, collection_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, $2, 't', 'f.txt', 'text/plain', 1, $3, 'x') RETURNING id",
          [eric.id, col!.id, `${stamp}-${++seq}`],
        )
      )[0]!.id;
    const [d1, d2] = [await doc(), await doc()];
    const t1 = await w.tags.create(eric.id, actorOf(eric), KIND.document, { name: `Bail ${stamp}`, marker: "green" });
    const t2 = await w.tags.create(eric.id, actorOf(eric), KIND.document, { name: `2026 ${stamp}`, marker: "gray" });
    await w.tags.apply(eric.id, actorOf(eric), KIND.document, { ids: [d1, d2], add: [t1.id] });
    await w.tags.apply(eric.id, actorOf(eric), KIND.document, { ids: [d1], add: [t2.id] });
    expect((await browse(query, eric.id, { collectionId: col!.id, tagIds: [t1.id, t2.id] })).documentIds).toEqual([d1]);
    expect((await browse(query, eric.id, { collectionId: col!.id, tagIds: [t1.id] })).documentIds.sort(byText)).toEqual(
      [d1, d2].sort(byText),
    );
    expect((await browse(query, eric.id, { collectionId: col!.id, tagIds: [] })).documentIds).toEqual(
      expect.arrayContaining([d1, d2]),
    );
    expect(filterSql(WORKSPACE, KIND.document, { tags: [t1.id] }, { from: 2 }).sql).toContain("organize.document_tag");
  });

  it("gives a document tags only: it has no decision to move", async () => {
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, 't', 'f.txt', 'text/plain', 1, $2, 'x') RETURNING id",
      [eric.id, `${stamp}-doc`],
    );
    expect(
      await codeOf(ws().status.move(eric.id, actorOf(eric), KIND.document, { ids: [doc!.id], to: DECISION.selected })),
    ).toBe("BAD_REQUEST");
  });

  it("shares saved views inside the account and keeps a stranger's out; the system views come first", async () => {
    const w = ws();
    const mine = await w.views.create(eric.id, actorOf(eric), KIND.applicantFile, {
      name: `Villeray ${stamp}`,
      filters: { status: [DECISION.toDecide], q: "villeray" },
    });
    const views = await w.views.list(eric.id, actorOf(eric), KIND.applicantFile);
    expect(views.system.map((v) => v.key)).toEqual(["to_decide", "decided"]);
    expect(views.mine.map((v) => v.id)).toContain(mine.id);
    expect(await codeOf(w.views.update(eric.id, actorOf(stranger), mine.id, { name: "x" }))).toBe("NOT_FOUND");
    expect(
      await codeOf(
        w.views.create(eric.id, actorOf(eric), KIND.applicantFile, { name: "Bad", filters: { status: ["nope"] } }),
      ),
    ).toBe("BAD_REQUEST");
  });
});
