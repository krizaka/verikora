import {
  BULK_MAX,
  checkKindConfig,
  createWorkspace,
  filterSql,
  memoryWorkspaceStore,
  movesFrom,
  parseView,
  statusOrder,
  undoOf,
  viewHref,
} from "@krizaka/organize";
import { describe, expect, it } from "vitest";

import { DECISION, isKind, KIND, OWNER_ROLE, WORKSPACE } from "./decl";
import { DECISION_SET, DEFAULT_CONFIGS } from "./defaults";
import { decisionOrder, sortByDecision } from "./order";

const ACTOR = { id: "00000000-0000-4000-8000-000000000001", label: "eric@example.test", role: OWNER_ROLE };
const SCOPE = ACTOR.id;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-25T12:00:00Z");

/** The layer over its in-memory store, as Verikora wires it (the transaction is the identity; the consequence is a spy). */
function workspaceWith(files: string[], onMoved: (moves: readonly unknown[]) => Promise<void> = async () => undefined) {
  const entities = new Map([
    [KIND.applicantFile, new Map(files.map((f) => [f, SCOPE]))],
    [KIND.document, new Map<string, string>()],
  ]);
  const store = memoryWorkspaceStore(entities);
  const workspace = createWorkspace({
    transaction: (work) => work((async () => []) as never),
    storeFor: () => store,
    clock: { now: () => NOW },
    onMoved: (_tx, moves) => onMoved(moves),
  });
  return { workspace, store };
}

describe("the decision set (verikora#324)", () => {
  it("is a valid status set, and the defaults of both kinds are valid configurations", () => {
    for (const config of Object.values(DEFAULT_CONFIGS)) expect(() => checkKindConfig(config)).not.toThrow();
  });

  it("goes from « à décider » to « retenu » or « non retenu », both final", () => {
    expect(DECISION_SET.initial).toBe(DECISION.toDecide);
    expect(DECISION_SET.states.map((s) => s.key)).toEqual([DECISION.toDecide, DECISION.selected, DECISION.notSelected]);
    expect(DECISION_SET.states.filter((s) => s.final).map((s) => s.key)).toEqual([
      DECISION.selected,
      DECISION.notSelected,
    ]);
  });

  it("asks two presses to refuse, one to select", () => {
    const moves = movesFrom(DECISION_SET, DECISION.toDecide, OWNER_ROLE);
    expect(moves.map((m) => [m.to, m.confirm === true])).toEqual([
      [DECISION.selected, false],
      [DECISION.notSelected, true],
    ]);
  });

  it("accepts no reason: none is declared, so none is accepted (there is never a free-text reason about a person)", () => {
    expect(DECISION_SET.transitions.every((t) => t.reasons === undefined)).toBe(true);
  });

  it("offers no way out of a decision, and so no undo: deciding closes the file and purges its documents", () => {
    expect(movesFrom(DECISION_SET, DECISION.selected, OWNER_ROLE)).toEqual([]);
    expect(movesFrom(DECISION_SET, DECISION.notSelected, OWNER_ROLE)).toEqual([]);
    expect(undoOf(DECISION_SET, { from: DECISION.toDecide, to: DECISION.selected }, OWNER_ROLE)).toBeNull();
    expect(undoOf(DECISION_SET, { from: DECISION.toDecide, to: DECISION.notSelected }, OWNER_ROLE)).toBeNull();
  });

  it("is the owner's: another role has no move", () => {
    expect(movesFrom(DECISION_SET, DECISION.toDecide, "member")).toEqual([]);
  });

  it("never wears danger: a person's decision is the manager's word, not a fault", () => {
    expect(DECISION_SET.states.map((s) => s.tone)).not.toContain("danger");
  });

  it("gives documents tags only, and two system views over the decision", () => {
    expect(DEFAULT_CONFIGS[KIND.document].status).toBeNull();
    expect(DEFAULT_CONFIGS[KIND.applicantFile].views.map((v) => [v.key, v.filters.status])).toEqual([
      ["to_decide", [DECISION.toDecide]],
      ["decided", [DECISION.selected, DECISION.notSelected]],
    ]);
  });
});

describe("the order of the decision column (no sort by a check's result)", () => {
  const set = DECISION_SET;
  it("is the set's order", () => {
    expect([...statusOrder(set)]).toEqual([
      [DECISION.toDecide, 0],
      [DECISION.selected, 1],
      [DECISION.notSelected, 2],
    ]);
    expect(decisionOrder(set, DECISION.notSelected)).toBeGreaterThan(decisionOrder(set, DECISION.toDecide));
  });

  it("sorts files by their decision and, within one, by the day they were asked: a check's result changes nothing", () => {
    const rows = [
      { id: "a", decision: DECISION.notSelected, createdAt: "2026-10-01", attention: 0 },
      { id: "b", decision: DECISION.toDecide, createdAt: "2026-10-02", attention: 9 },
      { id: "c", decision: DECISION.toDecide, createdAt: "2026-10-03", attention: 0 },
      { id: "d", decision: DECISION.selected, createdAt: "2026-10-04", attention: 5 },
    ];
    expect(sortByDecision(rows, set).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect(sortByDecision(rows, set, "desc").map((r) => r.id)).toEqual(["a", "d", "b", "c"]);
    // the same rows with every result swapped sort the same way
    const swapped = rows.map((r) => ({ ...r, attention: 9 - r.attention }));
    expect(sortByDecision(swapped, set).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("the address holds the view", () => {
  it("writes and reads the same filters, in one canonical order", () => {
    const filters = { tags: [id(7)], status: [DECISION.toDecide], q: "villeray" };
    const href = viewHref("/fr/app/dossiers", filters, "to_decide");
    expect(href).toBe(`/fr/app/dossiers?view=to_decide&tags=${id(7)}&status=a_decider&q=villeray`);
    const read = parseView(new URL(href, "https://x.test").searchParams);
    expect(read).toEqual({ view: "to_decide", filters });
  });

  it("drops what is malformed instead of failing", () => {
    expect(parseView({ tags: "not-an-id", status: "UPPER CASE", from: "2026-02-30" }).filters).toEqual({});
  });
});

describe("the filter replaces the ALL-tags clause", () => {
  it("keeps the same semantics (every selected tag worn) on the table's alias, numbering its parameters from the caller's", () => {
    const { sql, params } = filterSql(WORKSPACE, KIND.document, { tags: [id(1), id(2)] }, { from: 4 });
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM unnest($4::uuid[]) want(id)");
    expect(sql).toContain("organize.document_tag");
    expect(params).toEqual([[id(1), id(2)]]);
  });

  it("reads the decision with its initial state for a file nobody moved", () => {
    const { sql, params } = filterSql(
      WORKSPACE,
      KIND.applicantFile,
      { status: [DECISION.toDecide] },
      { from: 2, status: DECISION_SET },
    );
    expect(sql).toContain(
      "COALESCE((SELECT s.state FROM organize.applicant_file_status s WHERE s.entity_id = e.id), $2) = ANY($3::text[])",
    );
    expect(params).toEqual([DECISION.toDecide, [DECISION.toDecide]]);
  });
});

describe("the layer as Verikora wires it", () => {
  it("decides a file: the move is made, handed to the consequence (the file closes and its documents go) and nothing else moves", async () => {
    const seen: unknown[][] = [];
    const { workspace } = workspaceWith([id(1), id(2)], async (moves) => void seen.push([...moves]));
    await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    const result = await workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, {
      ids: [id(1)],
      to: DECISION.selected,
      expect: DECISION.toDecide,
    });
    expect(result.moved.map((m) => [m.entityId, m.from, m.to, m.final])).toEqual([
      [id(1), DECISION.toDecide, DECISION.selected, true],
    ]);
    expect(seen).toHaveLength(1);
    const states = await workspace.status.of(SCOPE, KIND.applicantFile, [id(1), id(2)]);
    expect(states.get(id(1))?.state).toBe(DECISION.selected);
    expect(states.get(id(2))?.state).toBe(DECISION.toDecide);
  });

  it("deciding twice leaves one decision and one refusal: a decision is final", async () => {
    const { workspace } = workspaceWith([id(1)]);
    await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    const first = await workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, {
      ids: [id(1)],
      to: DECISION.selected,
    });
    expect(first.moved).toHaveLength(1);
    await expect(
      workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, { ids: [id(1)], to: DECISION.notSelected }),
    ).rejects.toMatchObject({ code: "MOVE_NOT_ALLOWED" });
    expect((await workspace.status.of(SCOPE, KIND.applicantFile, [id(1)])).get(id(1))?.state).toBe(DECISION.selected);
  });

  it("in bulk, the file already decided is skipped and named; the others are decided", async () => {
    const { workspace } = workspaceWith([id(1), id(2)]);
    await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    await workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, { ids: [id(1)], to: DECISION.selected });
    const result = await workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, {
      ids: [id(1), id(2)],
      to: DECISION.notSelected,
    });
    expect(result.moved.map((m) => m.entityId)).toEqual([id(2)]);
    expect(result.skipped).toEqual([{ id: id(1), code: "MOVE_NOT_ALLOWED" }]);
  });

  it("refuses a single file whose decision changed since the manager saw it (STALE, 409)", async () => {
    const { workspace } = workspaceWith([id(1)]);
    await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    await workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, { ids: [id(1)], to: DECISION.selected });
    await expect(
      workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, {
        ids: [id(1)],
        to: DECISION.notSelected,
        expect: DECISION.toDecide,
      }),
    ).rejects.toMatchObject({ code: "STALE", status: 409 });
  });

  it("answers 404 for a file of another account, and moves nothing", async () => {
    const { workspace } = workspaceWith([id(1)]);
    await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    const stranger = { ...ACTOR, id: id(99) };
    await expect(
      workspace.status.move(id(99), stranger, KIND.applicantFile, { ids: [id(1)], to: DECISION.selected }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect((await workspace.status.of(SCOPE, KIND.applicantFile, [id(1)])).get(id(1))?.state).toBe(DECISION.toDecide);
  });

  it(`takes at most ${BULK_MAX} files a call`, async () => {
    const files = Array.from({ length: BULK_MAX + 1 }, (_, i) => id(i + 1));
    const { workspace } = workspaceWith(files);
    await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    await expect(
      workspace.status.move(SCOPE, ACTOR, KIND.applicantFile, { ids: files, to: DECISION.selected }),
    ).rejects.toMatchObject({ code: "TOO_MANY" });
  });

  it("seeds once: the database stays the source of truth after", async () => {
    const { workspace } = workspaceWith([]);
    const first = await workspace.config.seed(DEFAULT_CONFIGS[KIND.applicantFile]);
    const changed = { ...DEFAULT_CONFIGS[KIND.applicantFile], views: [] };
    const again = await workspace.config.seed(changed);
    expect(again.version).toBe(first.version);
    expect(again.config.views).toHaveLength(2);
  });

  it("knows its two kinds, and refuses any other", () => {
    expect(isKind("applicant_file")).toBe(true);
    expect(isKind("document")).toBe(true);
    expect(isKind("screening")).toBe(false);
    expect(isKind(undefined)).toBe(false);
  });
});
