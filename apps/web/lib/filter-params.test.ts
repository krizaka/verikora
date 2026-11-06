import { readFilterParams as packageRead, writeFilterParams as packageWrite } from "@krizaka/ui/filter-bar";
import { describe, expect, it } from "vitest";

import { readFilterParams, writeFilterParams } from "./filter-params";

describe("the address's filters, as plain functions (a server page cannot call the client module's, verikora#457)", () => {
  const search = new URLSearchParams("state=open,used&state=%20closed%20&q=&page=3&x=1");
  it("reads repeated and comma-separated values, trimmed", () => {
    expect(readFilterParams(search, ["state", "q", "none"])).toEqual({
      state: ["open", "used", "closed"],
      q: [],
      none: [],
    });
  });
  it("writes a list, deletes an empty key and resets the paging", () => {
    const next = writeFilterParams(search, { state: ["used"], q: null, tags: ["a", "b"] });
    expect(next.toString()).toBe("state=used&x=1&tags=a%2Cb");
  });
  it("stays identical to @krizaka/ui/filter-bar", () => {
    expect(readFilterParams(search, ["state", "q"])).toEqual(packageRead(search, ["state", "q"]));
    const filters = { state: ["open"], q: "bail", kind: [] as string[] };
    expect(writeFilterParams(search, filters).toString()).toBe(packageWrite(search, filters).toString());
  });
});
