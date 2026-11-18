import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { BYTES_QUERY, problemOf } from "./check-document-bytes.mjs";

describe("the document bytes guard on the seeded database (ADR-0012)", () => {
  it("accepts a database that keeps no bytes", () => {
    assert.equal(problemOf([]), null);
  });
  it("names the documents that keep bytes and how many", () => {
    assert.match(
      problemOf([
        { id: "d1", bytes: 12 },
        { id: "d2", bytes: 3 },
      ]),
      /2 document\(s\).*d1 \(12 bytes\), d2 \(3 bytes\)/,
    );
  });
  it("looks for any non-empty content", () => {
    assert.match(BYTES_QUERY, /octet_length\(content\) > 0/);
  });
});
