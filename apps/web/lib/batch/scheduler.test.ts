import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startScheduler } from "./scheduler";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("the batch tick's loop (verikora#240)", () => {
  it("runs after the interval the setting gives, and reads it again each time — a change is obeyed at the next look", async () => {
    let seconds = 20;
    const run = vi.fn(async () => undefined);
    const scheduler = startScheduler({ seconds: async () => seconds, run });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    seconds = 5;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("0 turns it off without stopping the loop: it looks again later and starts as soon as the setting says so", async () => {
    let seconds = 0;
    const run = vi.fn(async () => undefined);
    const scheduler = startScheduler({ seconds: async () => seconds, run, idleSeconds: 30 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).not.toHaveBeenCalled();
    seconds = 10;
    await vi.advanceTimersByTimeAsync(30_000 + 10_000);
    expect(run).toHaveBeenCalled();
    scheduler.stop();
  });

  it("one failure never ends the loop, and the setting being unreadable only delays it", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const run = vi.fn(async () => {
      if (++calls === 1) throw new Error("boom");
    });
    let readable = false;
    const scheduler = startScheduler({
      seconds: async () => {
        if (!readable) throw new Error("db down");
        return 10;
      },
      run,
      onError: (e) => void errors.push(e),
      idleSeconds: 5,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    readable = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(2);
    scheduler.stop();
  });

  it("stop() ends it", async () => {
    const run = vi.fn(async () => undefined);
    const scheduler = startScheduler({ seconds: async () => 10, run });
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
  });
});
