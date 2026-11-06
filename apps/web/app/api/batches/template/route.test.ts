import { readBatchManifest } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("the batch template (verikora#232)", () => {
  it("is a CSV a spreadsheet opens with its accents, and it reads back as two valid rows", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toContain(".csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(readBatchManifest(new TextDecoder().decode(bytes)).rows.every((r) => r.errors.length === 0)).toBe(true);
  });
});
