import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { text: string; values: unknown[] };
type Row = Record<string, unknown>;

interface Audited {
  action: string;
  actorId: string | null;
  actorLabel: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

const world: {
  calls: Call[];
  answer: (text: string, values: unknown[]) => Row[];
  audits: Audited[];
  logged: string[];
  billing: { charge: (r: unknown) => Promise<{ ref: string }>; refund: (ref: string) => Promise<void> } | null;
  billingFails: boolean;
  adapters: Record<string, CheckProvider>;
} = { calls: [], answer: () => [], audits: [], logged: [], billing: null, billingFails: false, adapters: {} };

vi.mock("../db", () => ({
  query: async (text: string, values: unknown[] = []) => {
    world.calls.push({ text, values });
    return world.answer(text, values);
  },
}));
vi.mock("../audit", () => ({ audit: async (entry: Audited) => void world.audits.push(entry) }));
vi.mock("../log", () => ({ logError: (message: string) => void world.logged.push(message) }));
vi.mock("./billing-config", () => ({
  screeningBillingPort: async () => {
    if (world.billingFails) {
      throw new Error("settings down");
    }
    return world.billing;
  },
}));
vi.mock("./providers", () => ({
  adapterFor: (key: string) => {
    const provider = world.adapters[key];
    if (!provider) {
      throw new Error(`no adapter ${key}`);
    }
    return provider;
  },
}));

import { collectOne, collectPending, type Due, dueChecks, refreshResult } from "./collect";
import type { CheckAnswer, CheckCall, CheckPurpose } from "./model";
import type { CheckProvider } from "./providers";

const NOW = new Date("2026-11-15T10:00:00Z");

const due = (over: Partial<Due> = {}): Due => ({
  id: "chk-1",
  screening_id: "scr-1",
  check_type: "court-records-qc",
  provider_ref: "ref-1",
  run_id: "run-1",
  polls: 0,
  landlord_id: "landlord-1",
  tenant_name: "Camille Jean Fictif",
  purpose: "COURT_RECORDS",
  region: "QC",
  adapter: "fake",
  poll_minutes: 15,
  poll_max: 4,
  ...over,
});

const answer = (outcome: CheckAnswer["outcome"], over: Partial<CheckAnswer> = {}): CheckAnswer => ({
  outcome,
  refusal: null,
  category: "NONE",
  providerRef: null,
  ...over,
});

interface Polled {
  purpose: CheckPurpose;
  call: CheckCall;
  ref: string;
}
function fakeProvider(reply: () => Promise<CheckAnswer>) {
  const polled: Polled[] = [];
  const provider: CheckProvider = {
    demo: true,
    submit: async () => answer("PENDING"),
    collect: async (purpose, call, ref) => {
      polled.push({ purpose, call, ref });
      return reply();
    },
  };
  return { provider, polled };
}

const sqlOf = (needle: string) => world.calls.filter((c) => c.text.includes(needle));

/** A screening row whose summary holds two lines, as consent left it. */
const summary = {
  band: "incomplete",
  generatedAt: "2026-11-01T00:00:00.000Z",
  items: [
    { key: "credit", outcome: "pending" },
    { key: "court-records-qc", outcome: "pending" },
  ],
};

beforeEach(() => {
  world.calls = [];
  world.answer = () => [];
  world.audits = [];
  world.logged = [];
  world.billing = null;
  world.billingFails = false;
  world.adapters = {};
});

describe("which checks are due", () => {
  it("asks for the pending checks whose poll time has come, oldest first, bounded", async () => {
    world.answer = () => [due() as unknown as Row];
    const rows = await dueChecks(NOW, 10);
    expect(rows).toEqual([due()]);
    expect(world.calls[0]!.values).toEqual([NOW, 10]);
    expect(world.calls[0]!.text).toContain("c.state = 'pending' AND c.next_poll_at <= $1");
  });
});

describe("rebuilding the summary the tenant sees", () => {
  const rowsOf = (...lines: [string, string, string | null][]) =>
    lines.map(([check_type, outcome, refusal]) => ({ check_type, outcome, refusal }));

  function respond(lines: Row[], current: Row[]) {
    world.answer = (text) =>
      text.includes("FROM screening_checks") ? lines : text.includes("SELECT result") ? current : [];
  }

  it("keeps the order of the first summary, recomputes the band and stamps the instant", async () => {
    respond(rowsOf(["court-records-qc", "MATCH", null], ["credit", "NO_MATCH", null]), [{ result: summary }]);
    await refreshResult("scr-1", NOW);
    const [update] = sqlOf("UPDATE screenings SET result");
    expect(update!.values[0]).toBe("scr-1");
    expect(JSON.parse(update!.values[1] as string)).toEqual({
      band: "review",
      generatedAt: NOW.toISOString(),
      items: [
        { key: "credit", outcome: "clear" },
        { key: "court-records-qc", outcome: "review" },
      ],
    });
  });

  it("says « no concern » only when every line is answered with no match", async () => {
    respond(rowsOf(["credit", "NO_MATCH", null], ["court-records-qc", "NO_MATCH", null]), [{ result: summary }]);
    await refreshResult("scr-1", NOW);
    expect(JSON.parse(sqlOf("UPDATE screenings")[0]!.values[1] as string).band).toBe("no-concern");
  });

  it("reads a check that cannot run as incomplete, never as clear", async () => {
    respond(rowsOf(["credit", "NO_MATCH", null], ["court-records-qc", "REFUSED", "NOT_CONFIGURED"]), [
      { result: summary },
    ]);
    await refreshResult("scr-1", NOW);
    const written = JSON.parse(sqlOf("UPDATE screenings")[0]!.values[1] as string);
    expect(written.band).toBe("incomplete");
    expect(written.items[1]).toEqual({ key: "court-records-qc", outcome: "soon" });
  });

  it("puts a line the first summary did not know after the known ones", async () => {
    respond(rowsOf(["zzz-new", "NO_MATCH", null], ["credit", "NO_MATCH", null]), [{ result: summary }]);
    await refreshResult("scr-1", NOW);
    const keys = JSON.parse(sqlOf("UPDATE screenings")[0]!.values[1] as string).items.map(
      (i: { key: string }) => i.key,
    );
    expect(keys).toEqual(["credit", "zzz-new"]);
  });

  it("writes nothing when the screening has no summary yet, or no check line", async () => {
    respond(rowsOf(["credit", "NO_MATCH", null]), [{ result: null }]);
    await refreshResult("scr-1", NOW);
    respond([], [{ result: summary }]);
    await refreshResult("scr-1", NOW);
    respond(rowsOf(["credit", "NO_MATCH", null]), []);
    await refreshResult("scr-1", NOW);
    expect(sqlOf("UPDATE screenings")).toEqual([]);
  });
});

describe("polling one check", () => {
  /** The database as the collector finds it: the check is still pending (the guarded UPDATE returns its id). */
  function pendingCheck() {
    world.answer = (text) => {
      if (text.includes("UPDATE screening_checks SET state")) {
        return [{ id: "chk-1" }];
      }
      if (text.includes("FROM screening_checks")) {
        return [{ check_type: "court-records-qc", outcome: "NO_MATCH", refusal: null }];
      }
      if (text.includes("SELECT result")) {
        return [{ result: summary }];
      }
      return [];
    };
  }

  it("asks the provider with the tenant's names, the purpose, the region and the opaque reference", async () => {
    pendingCheck();
    const { provider, polled } = fakeProvider(async () => answer("NO_MATCH"));
    await collectOne(due(), provider, NOW);
    expect(polled).toEqual([
      {
        purpose: "COURT_RECORDS",
        ref: "ref-1",
        call: {
          userId: "landlord-1",
          runId: "run-1",
          subject: { subjectId: "scr-1", firstName: "Camille", lastName: "Jean Fictif" },
          region: "QC",
        },
      },
    ]);
  });

  it("sends an empty reference when the check has none", async () => {
    pendingCheck();
    const { provider, polled } = fakeProvider(async () => answer("NO_MATCH"));
    await collectOne(due({ provider_ref: null }), provider, NOW);
    expect(polled[0]!.ref).toBe("");
  });

  it("settles an answer once: state, outcome, the new reference, the instant, then the summary and the trail", async () => {
    pendingCheck();
    const { provider } = fakeProvider(async () => answer("MATCH", { category: "CIVIL", providerRef: "ref-2" }));
    expect(await collectOne(due(), provider, NOW)).toBe(true);
    const [settle] = sqlOf("UPDATE screening_checks SET state");
    expect(settle!.text).toContain("WHERE id = $1 AND state = 'pending'");
    expect(settle!.values).toEqual(["chk-1", "answered", "MATCH", null, "CIVIL", "ref-2", NOW]);
    expect(sqlOf("UPDATE screenings SET result")).toHaveLength(1);
    expect(world.audits).toEqual([
      {
        action: "screening.check.collected",
        actorId: null,
        actorLabel: "collector",
        targetId: "scr-1",
        detail: { checkType: "court-records-qc", outcome: "MATCH", state: "answered", runId: "run-1" },
      },
    ]);
  });

  it("asks again after the provider's interval while the answer is still pending, settling nothing", async () => {
    const { provider } = fakeProvider(async () => answer("PENDING"));
    expect(await collectOne(due({ polls: 1 }), provider, NOW)).toBe(false);
    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]!.text).toContain("polls = polls + 1, next_poll_at = $2");
    expect(world.calls[0]!.values).toEqual(["chk-1", new Date("2026-11-15T10:15:00Z")]);
    expect(world.audits).toEqual([]);
  });

  it("treats a failing poll as a pending answer: the check stays pending, the failure is logged", async () => {
    const { provider } = fakeProvider(async () => Promise.reject(new Error("timeout")));
    expect(await collectOne(due(), provider, NOW)).toBe(false);
    expect(world.logged).toEqual(["screening: a poll failed"]);
    expect(world.calls[0]!.values).toEqual(["chk-1", new Date("2026-11-15T10:15:00Z")]);
  });

  it("gives up with a timeout when the tries are spent, so a check is never pending for good", async () => {
    pendingCheck();
    const { provider } = fakeProvider(async () => answer("PENDING"));
    expect(await collectOne(due({ polls: 3, poll_max: 4 }), provider, NOW)).toBe(true);
    expect(sqlOf("UPDATE screening_checks SET state")[0]!.values).toEqual([
      "chk-1",
      "unavailable",
      "TIMEOUT",
      null,
      "NONE",
      null,
      NOW,
    ]);
    expect(world.audits[0]!.detail).toMatchObject({ outcome: "TIMEOUT", state: "unavailable" });
  });

  it("changes nothing twice: a check another instance settled first is not refreshed, billed or audited", async () => {
    world.answer = () => [];
    const { provider } = fakeProvider(async () => answer("NO_MATCH"));
    expect(await collectOne(due(), provider, NOW)).toBe(false);
    expect(world.calls).toHaveLength(1);
    expect(world.audits).toEqual([]);
  });

  describe("a charged check the provider never answered", () => {
    const refunds: string[] = [];
    function charged() {
      refunds.length = 0;
      world.billing = { charge: async () => ({ ref: "c" }), refund: async (ref) => void refunds.push(ref) };
      world.answer = (text) => {
        if (text.includes("UPDATE screening_checks SET state")) {
          return [{ id: "chk-1" }];
        }
        if (text.includes("FROM screening_charge")) {
          return [{ id: "ch-1", charge_ref: "charge-9" }];
        }
        if (text.includes("UPDATE screening_charge")) {
          return [{ id: "ch-1" }];
        }
        return [];
      };
    }
    const failing = () => fakeProvider(async () => answer("PROVIDER_ERROR")).provider;

    it("is refunded once, when billing is on", async () => {
      charged();
      await collectOne(due(), failing(), NOW);
      expect(refunds).toEqual(["charge-9"]);
      expect(sqlOf("UPDATE screening_charge")[0]!.values).toEqual(["ch-1", NOW]);
    });
    it("is not refunded while billing is off", async () => {
      charged();
      world.billing = null;
      await collectOne(due(), failing(), NOW);
      expect(refunds).toEqual([]);
      expect(sqlOf("screening_charge")).toEqual([]);
    });
    it("is not refunded when the check was answered", async () => {
      charged();
      await collectOne(due(), fakeProvider(async () => answer("NO_MATCH")).provider, NOW);
      expect(refunds).toEqual([]);
    });
    it("never undoes the settlement when the refund fails: it is logged and the check still counts as settled", async () => {
      charged();
      world.billingFails = true;
      expect(await collectOne(due(), failing(), NOW)).toBe(true);
      expect(world.logged).toContain("screening: a refund failed");
      expect(world.audits).toHaveLength(1);
    });
  });
});

describe("one look at the due checks", () => {
  it("polls each due check with its provider's adapter and counts the ones settled", async () => {
    const settledOne = fakeProvider(async () => answer("NO_MATCH"));
    const stillPending = fakeProvider(async () => answer("PENDING"));
    world.adapters = { done: settledOne.provider, wait: stillPending.provider };
    world.answer = (text) => {
      if (text.includes("c.next_poll_at <= $1")) {
        return [due({ id: "a", adapter: "done" }), due({ id: "b", adapter: "wait" })] as unknown as Row[];
      }
      if (text.includes("UPDATE screening_checks SET state")) {
        return [{ id: "x" }];
      }
      return [];
    };
    expect(await collectPending(NOW, 5)).toEqual({ polled: 2, settled: 1 });
    expect(world.calls[0]!.values).toEqual([NOW, 5]);
    expect(settledOne.polled).toHaveLength(1);
    expect(stillPending.polled).toHaveLength(1);
  });

  it("looks at fifty checks at most by default", async () => {
    await collectPending(NOW);
    expect(world.calls[0]!.values).toEqual([NOW, 50]);
  });

  it("lets a check that raises stop nobody: the others are still collected", async () => {
    const good = fakeProvider(async () => answer("NO_MATCH"));
    world.adapters = { good: good.provider };
    world.answer = (text) => {
      if (text.includes("c.next_poll_at <= $1")) {
        return [due({ id: "a", adapter: "unknown" }), due({ id: "b", adapter: "good" })] as unknown as Row[];
      }
      if (text.includes("UPDATE screening_checks SET state")) {
        return [{ id: "x" }];
      }
      return [];
    };
    expect(await collectPending(NOW)).toEqual({ polled: 2, settled: 1 });
    expect(world.logged).toEqual(["screening: collecting a check failed"]);
  });
});
