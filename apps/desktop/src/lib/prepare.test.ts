import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, not a `vi.fn` that rejects: vitest 4 tracks a spy's promise and reports its settled rejection as unhandled.
let native: (path: string, maxBytes: number) => Promise<unknown>;
const calls: [string, number][] = [];
vi.mock("./desktop", async () => ({
  ...(await vi.importActual<typeof import("./desktop")>("./desktop")),
  verikoraNative: {
    readDocument: (path: string, maxBytes: number) => {
      calls.push([path, maxBytes]);
      return native(path, maxBytes);
    },
  },
}));

import { prepare, Refused } from "./prepare";

const limits = { maxFileBytes: 10 * 1024 * 1024, allowedTypes: ["application/pdf"] };

describe("prepare", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("passes the server's limit to the native read", async () => {
    native = () => Promise.resolve({ name: "a.pdf", mime: "application/pdf", size: 5, data: "JVBERi0=" });
    await prepare("/Users/x/a.pdf", limits);
    expect(calls).toEqual([["/Users/x/a.pdf", 10 * 1024 * 1024]]);
  });

  it("reads a native « too_large » as the pre-flight's too large, in megabytes", async () => {
    native = () => Promise.reject({ code: "too_large", message: "the file is too large" });
    await expect(prepare("/Users/x/a.pdf", limits)).rejects.toMatchObject({ reason: "tooLarge", megabytes: 10 });
  });

  it("reads any other native failure as unreadable", async () => {
    native = () => Promise.reject({ code: "scope_outside", message: "x" });
    const error = await prepare("/Users/x/a.pdf", limits).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Refused);
    expect(error).toMatchObject({ reason: "unreadable" });
  });
});
