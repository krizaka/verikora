import { describe, expect, it } from "vitest";

import { diffSnapshot } from "./schema-check";

const base = { tables: { "public.accounts": ["email", "id"] }, config: { "public.check_type": ["credit"] } };

describe("the schema check", () => {
  it("passes on the same schema", () => expect(diffSnapshot(base, base)).toEqual([]));

  it("names a missing column, a surprise table and a missing config key", () => {
    const actual = {
      tables: { "public.accounts": ["id"], "public.extra": ["x"] },
      config: { "public.check_type": [] },
    };
    expect(diffSnapshot(base, actual)).toEqual([
      "missing column public.accounts.email",
      "unexpected table public.extra",
      "missing config public.check_type credit",
    ]);
  });
});
