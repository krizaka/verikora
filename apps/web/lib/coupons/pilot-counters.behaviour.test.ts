import type { Query } from "@krizaka/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { text: string; values: unknown[] };
type Row = Record<string, unknown>;

const logged: string[] = [];
const dbState: { calls: Call[]; answer: (text: string, values: unknown[]) => Row[]; failTransaction: Error | null } = {
  calls: [],
  answer: () => [],
  failTransaction: null,
};

const fake = (async (text: string, values: unknown[] = []) => {
  dbState.calls.push({ text, values });
  return dbState.answer(text, values);
}) as Query;

vi.mock("../db", () => ({
  query: (text: string, values?: unknown[]) => fake(text, values),
  transaction: async <T>(work: (tx: Query) => Promise<T>): Promise<T> => {
    if (dbState.failTransaction) {
      throw dbState.failTransaction;
    }
    return work(fake);
  },
}));
vi.mock("../log", () => ({ logError: (message: string) => void logged.push(message) }));

import { countStage, PILOT_STAGE, pilotCounters, recordPayment, recordRealFile } from "./pilot-counters";

const sqlOf = (needle: string) => dbState.calls.filter((c) => c.text.includes(needle));
const PILOT = { coupon_id: "coupon-1" };

beforeEach(() => {
  dbState.calls = [];
  dbState.answer = () => [];
  dbState.failTransaction = null;
  logged.length = 0;
});

describe("raising one stage of an account's pilot code", () => {
  it("adds one to the code that opened the pilot, for the given stage", async () => {
    dbState.answer = (text) => (text.includes("FROM coupons.redemption") ? [PILOT] : []);
    await countStage(fake, "acc-1", PILOT_STAGE.activated);
    expect(sqlOf("FROM coupons.redemption")[0]!.values).toEqual(["acc-1", "demo"]);
    const [bump] = sqlOf("INSERT INTO public.pilot_counter");
    expect(bump!.values).toEqual(["coupon-1", "activated"]);
    expect(bump!.text).toContain("ON CONFLICT (coupon_id, stage) DO UPDATE SET n = pilot_counter.n + 1");
  });
  it("changes nothing for an account without a pilot", async () => {
    await countStage(fake, "acc-1", PILOT_STAGE.activated);
    expect(sqlOf("pilot_counter")).toEqual([]);
  });
});

describe("the first real file", () => {
  it("is counted once the account's first non-sample file is flagged, under the account's row lock", async () => {
    dbState.answer = (text) => {
      if (text.includes("FROM coupons.redemption")) {
        return [PILOT];
      }
      if (text.includes("UPDATE analyses")) {
        return [{ id: "an-1" }];
      }
      return [];
    };
    await recordRealFile("acc-1", "an-1");
    expect(dbState.calls[0]!.text).toBe("SELECT id FROM accounts WHERE id = $1 FOR UPDATE");
    expect(sqlOf("UPDATE analyses")[0]!.values).toEqual(["acc-1", "an-1"]);
    expect(sqlOf("INSERT INTO public.pilot_counter")[0]!.values).toEqual(["coupon-1", "first_real_file"]);
  });
  it("is not counted when no file qualified (a sample, or an earlier file was already counted)", async () => {
    dbState.answer = (text) => (text.includes("FROM coupons.redemption") ? [PILOT] : []);
    await recordRealFile("acc-1", "an-1");
    expect(sqlOf("INSERT INTO public.pilot_counter")).toEqual([]);
  });
  it("does not even look at files for an account without a pilot", async () => {
    await recordRealFile("acc-1", "an-1");
    expect(sqlOf("UPDATE analyses")).toEqual([]);
  });
  it("never fails the file: a failure of the count is logged", async () => {
    dbState.failTransaction = new Error("db down");
    await expect(recordRealFile("acc-1", "an-1")).resolves.toBeUndefined();
    expect(logged).toEqual(["pilot: the first real file could not be counted"]);
  });
});

describe("payments", () => {
  const withPurchases = (n: string | null) => {
    dbState.answer = (text) => {
      if (text.includes('credits."grant"')) {
        return n === null ? [] : [{ n }];
      }
      if (text.includes("FROM coupons.redemption")) {
        return [PILOT];
      }
      return [];
    };
  };
  const stagesRaised = () => sqlOf("INSERT INTO public.pilot_counter").map((c) => c.values[1]);

  it("raises the first-payment stage on the first purchase", async () => {
    withPurchases("1");
    await recordPayment(fake, "acc-1");
    expect(stagesRaised()).toEqual(["first_payment"]);
  });
  it("raises the second-payment stage on the second purchase", async () => {
    withPurchases("2");
    await recordPayment(fake, "acc-1");
    expect(stagesRaised()).toEqual(["second_payment"]);
  });
  it("raises nothing from the third purchase on, or with none", async () => {
    withPurchases("3");
    await recordPayment(fake, "acc-1");
    withPurchases("0");
    await recordPayment(fake, "acc-1");
    withPurchases(null);
    await recordPayment(fake, "acc-1");
    expect(stagesRaised()).toEqual([]);
  });
});

describe("the console's counters", () => {
  it("shows every code with zeros for the stages not reached, and the counts of those reached", async () => {
    dbState.answer = () => [
      { coupon_id: "c1", code: "AAA", stage: "activated", n: 4 },
      { coupon_id: "c1", code: "AAA", stage: "first_payment", n: 1 },
      { coupon_id: "c2", code: "BBB", stage: null, n: null },
    ];
    const counters = await pilotCounters(fake);
    expect(counters).toEqual([
      {
        couponId: "c1",
        code: "AAA",
        counts: { activated: 4, first_real_file: 0, first_payment: 1, second_payment: 0 },
      },
      {
        couponId: "c2",
        code: "BBB",
        counts: { activated: 0, first_real_file: 0, first_payment: 0, second_payment: 0 },
      },
    ]);
    expect(dbState.calls[0]!.values).toEqual(["demo"]);
  });
  it("reads through the shared query when none is given", async () => {
    dbState.answer = () => [{ coupon_id: "c1", code: "AAA", stage: "activated", n: null }];
    const [only] = await pilotCounters();
    expect(only!.counts.activated).toBe(0);
    expect(dbState.calls).toHaveLength(1);
  });
});
