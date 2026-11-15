import type { ObjectStore } from "@krizaka/storage";
import { type Actor, type ProviderService, type PublicProvider, sha256Hex } from "@krizaka/storage/provider-admin";
import type { QueryResultRow } from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import {
  currentMove,
  documentCatalog,
  MOVE_BATCH,
  MOVE_STATUS,
  type MoveDeps,
  setMovePaused,
  startMove,
  stepMove,
} from "./provider-move";

const ADMIN: Actor = { id: "admin-1", label: "admin@verikora.test" };
const T0 = new Date("2026-06-01T10:00:00Z");

interface Doc {
  id: string;
  key: string;
  bytes: Uint8Array;
  providerId: string;
}

interface Move {
  id: string;
  from_id: string;
  to_id: string;
  status: string;
  total: number;
  moved: number;
  failures: { id: string; reason: string }[];
  started_at: Date;
  finished_at: Date | null;
  leased_until: Date | null;
}

/** A small in-memory stand-in for the two tables the move reads and writes, answering the statements the module sends. */
function fakeDatabase() {
  const docs: Doc[] = [];
  let move: Move | null = null;
  const statements: { text: string; values: unknown[] }[] = [];
  const failInsertWith: { code?: string } = {};
  const view = (m: Move | null): QueryResultRow[] => (m ? [{ ...m }] : []);

  const held = (providerId: unknown) => docs.filter((d) => d.providerId === providerId);
  const moves = (...from: string[]) => (move && from.includes(move.status) ? move : null);

  type Route = [matches: (text: string) => boolean, answer: (values: unknown[]) => unknown[]];
  const routes: Route[] = [
    [(t) => t.includes("count(*)"), (v) => [{ n: String(held(v[0]).length) }]],
    [
      (t) => t.includes("FROM documents"),
      (v) =>
        held(v[0])
          .filter((d) => !(v[1] as string[]).includes(d.id))
          .slice(0, Number(v[2]))
          .map((d) => ({ id: d.id, key: d.key, contentType: "text/plain", sha256: sha256Hex(d.bytes) })),
    ],
    [
      (t) => t.startsWith("UPDATE documents"),
      (v) => {
        const doc = docs.find((d) => d.id === v[0] && d.providerId === v[1]);
        if (doc) {
          doc.providerId = String(v[2]);
        }
        return doc ? [{ id: doc.id }] : [];
      },
    ],
    [
      (t) => t.startsWith("INSERT INTO storage_moves"),
      (v) => {
        if (failInsertWith.code) {
          throw Object.assign(new Error("duplicate"), { code: failInsertWith.code });
        }
        move = {
          id: "move-1",
          from_id: String(v[0]),
          to_id: String(v[1]),
          status: String(v[2]),
          total: Number(v[3]),
          moved: 0,
          failures: [],
          started_at: v[5] as Date,
          finished_at: v[6] as Date | null,
          leased_until: null,
        };
        return view(move);
      },
    ],
    [(t) => t.startsWith("SELECT") && t.includes("FROM storage_moves"), () => view(move)],
    [
      (t) => t.includes("SET status = 'paused'"),
      () => {
        const open = moves("running", "attention");
        if (open) {
          open.status = "paused";
        }
        return view(open);
      },
    ],
    [
      (t) => t.includes("SET status = 'running'"),
      () => {
        const open = moves("paused", "attention");
        if (open) {
          Object.assign(open, { status: "running", failures: [], leased_until: null });
        }
        return view(open);
      },
    ],
    [
      (t) => t.includes("SET leased_until = $1"),
      (v) => {
        const running = moves("running");
        const free = running && !(running.leased_until && running.leased_until >= (v[1] as Date));
        if (running && free) {
          running.leased_until = v[0] as Date;
        }
        return free ? view(running) : [];
      },
    ],
    [
      (t) => t.includes("SET leased_until = NULL"),
      () => {
        if (move) {
          move.leased_until = null;
        }
        return [];
      },
    ],
    [
      (t) => t.includes("SET moved = moved +"),
      (v) => {
        const open = moves("running", "paused");
        if (open) {
          open.moved += Number(v[1]);
          open.failures = JSON.parse(String(v[2]));
          open.status = open.status === "paused" && v[3] !== "done" ? "paused" : String(v[3]);
          open.finished_at = v[5] as Date | null;
        }
        return view(open);
      },
    ],
  ];

  const q = async <T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
    statements.push({ text, values });
    const route = routes.find(([matches]) => matches(text));
    if (!route) {
      throw new Error(`unexpected statement: ${text}`);
    }
    return route[1](values) as T[];
  };
  return {
    q,
    docs,
    statements,
    failInsertWith,
    move: () => move,
    setMove: (m: Move) => {
      move = m;
    },
  };
}

const memoryObjects = (): ObjectStore & { held: Map<string, Uint8Array> } => {
  const held = new Map<string, Uint8Array>();
  return {
    held,
    put: async (key, bytes) => void held.set(key, bytes),
    get: async (key) => (held.has(key) ? { bytes: held.get(key)!, contentType: "text/plain" } : null),
    head: async () => null,
    delete: async (key) => void held.delete(key),
    list: async () => [],
    signedUrl: async () => null,
    publicUrl: () => null,
  };
};

const provider = (id: string, status: string): PublicProvider =>
  ({ id, scope: "org", kind: "folder", status }) as unknown as PublicProvider;

const refusal = (run: () => Promise<unknown>) =>
  run().then(
    () => null,
    (error: { status: number; body: { code?: string } }) => error,
  );

describe("the verified move of documents between providers", () => {
  let db: ReturnType<typeof fakeDatabase>;
  let stores: Record<string, ReturnType<typeof memoryObjects>>;
  let audit: { action: string; actor: Actor; targetId: string; detail: Record<string, unknown> }[];
  let providers: PublicProvider[];
  let defaults: Record<string, string>;
  let clock: Date;
  let deps: MoveDeps;

  const addDocs = (n: number) => {
    for (let i = 1; i <= n; i += 1) {
      const bytes = new TextEncoder().encode(`document ${i} ${"x".repeat(i)}`);
      const key = `o/d${i}/original.txt`;
      db.docs.push({ id: `d${i}`, key, bytes, providerId: "old" });
      stores.old!.held.set(key, bytes);
    }
  };

  beforeEach(() => {
    db = fakeDatabase();
    stores = { old: memoryObjects(), new: memoryObjects() };
    audit = [];
    providers = [provider("old", "retiring"), provider("new", "verified")];
    defaults = { documents: "new" };
    clock = T0;
    const service = {
      list: async () => providers,
      open: async (id: string) => stores[id]!,
    } as unknown as Pick<ProviderService, "list" | "open">;
    deps = {
      q: db.q,
      service,
      defaults: async () => defaults,
      audit: async (note) => void audit.push(note),
      now: () => clock,
      batch: 2,
    };
  });

  describe("the catalog the move reads", () => {
    it("lists the documents still at a provider, skipping the ones that already failed, and flips a row only once", async () => {
      addDocs(3);
      const catalog = documentCatalog(db.q, ["d1"]);
      expect((await catalog.pending("old", 10)).map((o) => o.id)).toEqual(["d2", "d3"]);
      expect(await catalog.remaining("old")).toBe(3);
      expect(await catalog.switchProvider("d2", "old", "new")).toBe(true);
      expect(await catalog.switchProvider("d2", "old", "new")).toBe(false);
      expect(await catalog.remaining("old")).toBe(2);
    });

    it("counts only the documents Krizaka's store holds", async () => {
      await documentCatalog(db.q, []).remaining("old");
      expect(db.statements.at(-1)?.text).toContain("storage_owner = 'krizaka'");
      expect(db.statements.at(-1)?.text).toContain("object_key IS NOT NULL");
    });
  });

  describe("starting a move", () => {
    it("refuses the same provider on both sides", async () => {
      const error = await refusal(() => startMove(deps, ADMIN, { from: "old", to: "old" }));
      expect(error?.status).toBe(409);
      expect(error?.body.code).toBe("STORAGE_MOVE_NOT_ALLOWED");
    });

    it("refuses an unknown provider", async () => {
      const error = await refusal(() => startMove(deps, ADMIN, { from: "old", to: "ghost" }));
      expect(error?.status).toBe(404);
      expect(error?.body.code).toBe("STORAGE_PROVIDER_NOT_FOUND");
    });

    it("refuses a target that is not the default of the documents", async () => {
      defaults = { documents: "old" };
      const error = await refusal(() => startMove(deps, ADMIN, { from: "old", to: "new" }));
      expect(error?.body.code).toBe("STORAGE_MOVE_NOT_ALLOWED");
      expect(db.move()).toBeNull();
    });

    it("refuses a source that is not retiring", async () => {
      providers = [provider("old", "verified"), provider("new", "verified")];
      const error = await refusal(() => startMove(deps, ADMIN, { from: "old", to: "new" }));
      expect(error?.body.code).toBe("STORAGE_MOVE_NOT_ALLOWED");
      expect(db.move()).toBeNull();
    });

    it("opens a running move with the count of documents to move, and audits it", async () => {
      addDocs(3);
      const view = await startMove(deps, ADMIN, { from: "old", to: "new" });
      expect(view).toEqual({
        id: "move-1",
        fromId: "old",
        toId: "new",
        status: MOVE_STATUS.running,
        total: 3,
        moved: 0,
        failed: [],
        remaining: 3,
        startedAt: T0.toISOString(),
        finishedAt: null,
      });
      expect(audit).toEqual([
        {
          action: "storage.move.started",
          actor: ADMIN,
          targetId: "move-1",
          detail: { from: "old", to: "new", total: 3 },
        },
      ]);
    });

    it("is done at once when there is nothing to move", async () => {
      const view = await startMove(deps, ADMIN, { from: "old", to: "new" });
      expect(view.status).toBe(MOVE_STATUS.done);
      expect(view.finishedAt).toBe(T0.toISOString());
      expect(view.remaining).toBe(0);
    });

    it("says a move is already open when the database refuses a second one", async () => {
      db.failInsertWith.code = "23505";
      const error = await refusal(() => startMove(deps, ADMIN, { from: "old", to: "new" }));
      expect(error?.status).toBe(409);
      expect(error?.body.code).toBe("STORAGE_MOVE_OPEN");
      expect(audit).toEqual([]);
    });

    it("does not hide another database failure", async () => {
      db.failInsertWith.code = "57P01";
      const error = await refusal(() => startMove(deps, ADMIN, { from: "old", to: "new" }));
      expect((error as unknown as { code?: string }).code).toBe("57P01");
    });
  });

  describe("reading the latest move", () => {
    it("is null when no move ever ran", async () => {
      expect(await currentMove(db.q)).toBeNull();
    });

    it("counts what is left, less the failures, and nothing once it is done", async () => {
      addDocs(4);
      db.setMove({
        id: "m",
        from_id: "old",
        to_id: "new",
        status: "attention",
        total: 4,
        moved: 0,
        failures: [{ id: "d1", reason: "x" }],
        started_at: T0,
        finished_at: null,
        leased_until: null,
      });
      expect((await currentMove(db.q))?.remaining).toBe(3);
      db.move()!.status = "done";
      db.move()!.finished_at = T0;
      const done = await currentMove(db.q);
      expect(done?.remaining).toBe(0);
      expect(done?.finishedAt).toBe(T0.toISOString());
    });
  });

  describe("pausing and resuming", () => {
    it("pauses a running move and audits it", async () => {
      addDocs(2);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      audit.length = 0;
      const view = await setMovePaused(deps, ADMIN, true);
      expect(view.status).toBe(MOVE_STATUS.paused);
      expect(audit).toEqual([{ action: "storage.move.paused", actor: ADMIN, targetId: "move-1", detail: {} }]);
    });

    it("resumes a paused move, forgetting the failures so they are tried again", async () => {
      addDocs(2);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      await setMovePaused(deps, ADMIN, true);
      db.move()!.failures = [{ id: "d1", reason: "x" }];
      audit.length = 0;
      const view = await setMovePaused(deps, ADMIN, false);
      expect(view.status).toBe(MOVE_STATUS.running);
      expect(view.failed).toEqual([]);
      expect(audit.map((a) => a.action)).toEqual(["storage.move.resumed"]);
    });

    it("says there is no move to pause or to resume", async () => {
      const pause = await refusal(() => setMovePaused(deps, ADMIN, true));
      expect(pause?.status).toBe(409);
      expect(pause?.body.code).toBe("STORAGE_MOVE_NONE");
      const resume = await refusal(() => setMovePaused(deps, ADMIN, false));
      expect(resume?.body.code).toBe("STORAGE_MOVE_NONE");
      expect(audit).toEqual([]);
    });
  });

  describe("a step of the move", () => {
    it("does nothing when no move is open", async () => {
      expect(await stepMove(deps)).toBeNull();
    });

    it("copies a batch, verifies it, flips the rows, and releases its lease", async () => {
      addDocs(3);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      const view = await stepMove(deps);
      expect(view).toMatchObject({ status: MOVE_STATUS.running, moved: 2, remaining: 1, failed: [] });
      expect(stores.new!.held.size).toBe(2);
      expect(db.docs.filter((d) => d.providerId === "new")).toHaveLength(2);
      expect(db.move()?.leased_until).toBeNull();
    });

    it("finishes the move on the last batch and audits its completion by the system", async () => {
      addDocs(3);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      await stepMove(deps);
      clock = new Date(T0.getTime() + 1000);
      audit.length = 0;
      const view = await stepMove(deps);
      expect(view).toMatchObject({ status: MOVE_STATUS.done, moved: 3, remaining: 0 });
      expect(view?.finishedAt).toBe(clock.toISOString());
      expect(audit).toEqual([
        {
          action: "storage.move.completed",
          actor: { id: null, label: "storage-move" },
          targetId: "move-1",
          detail: { moved: 3, from: "old", to: "new" },
        },
      ]);
      expect(await stepMove(deps)).toBeNull();
    });

    it("does not let a second worker step while the first holds the lease", async () => {
      addDocs(2);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      db.move()!.leased_until = new Date(T0.getTime() + 60_000);
      expect(await stepMove(deps)).toBeNull();
      expect(stores.new!.held.size).toBe(0);
    });

    it("takes the lease for two minutes and uses the default batch size when none is given", async () => {
      addDocs(1);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      await stepMove({ ...deps, batch: undefined });
      const lease = db.statements.find((s) => s.text.includes("SET leased_until = $1"));
      expect(lease?.values[0]).toEqual(new Date(T0.getTime() + 120_000));
      expect(MOVE_BATCH).toBe(10);
      expect(db.docs[0]?.providerId).toBe("new");
    });

    it("keeps a document that fails verification where it is, stops for attention, and audits the reason", async () => {
      addDocs(2);
      stores.new!.put = async (key) => void stores.new!.held.set(key, new TextEncoder().encode("corrupt"));
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      audit.length = 0;
      const view = await stepMove(deps);
      expect(view?.status).toBe(MOVE_STATUS.attention);
      expect(view?.moved).toBe(0);
      expect(view?.failed.map((f) => f.id).sort()).toEqual(["d1", "d2"]);
      expect(db.docs.every((d) => d.providerId === "old")).toBe(true);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: "storage.move.failed",
        actor: { id: null, label: "storage-move" },
        detail: { count: 2 },
      });
      expect(await stepMove(deps)).toBeNull();
    });

    it("releases its lease even when the store cannot be opened", async () => {
      addDocs(2);
      await startMove(deps, ADMIN, { from: "old", to: "new" });
      const broken = {
        list: deps.service.list,
        open: async () => {
          throw new Error("provider unreachable");
        },
      } as unknown as MoveDeps["service"];
      await expect(stepMove({ ...deps, service: broken })).rejects.toThrow("provider unreachable");
      expect(db.move()?.leased_until).toBeNull();
      expect(db.move()?.moved).toBe(0);
    });
  });
});
