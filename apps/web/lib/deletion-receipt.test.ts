import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DELETION_RECEIPT_SCHEMA,
  DELETION_RULE,
  issueDeletionReceipt,
  receiptSchemaOf,
  verifyDeletionReceipt,
} from "./deletion-receipt";
import { generateSigningKeyBase64, parseSigningKey } from "./report-key";

/** krizaka-internal#3381: the deletion receipt is signed with the report's key and checked by the report's verify path. */
const key = parseSigningKey(generateSigningKeyBase64());
const other = parseSigningKey(generateSigningKeyBase64());
const input = {
  receiptId: "11111111-1111-4111-8111-111111111111",
  documentId: "22222222-2222-4222-8222-222222222222",
  applicationId: "33333333-3333-4333-8333-333333333333",
  rule: DELETION_RULE.afterDecision,
  deletedAt: new Date("2026-11-13T10:00:00Z"),
  objects: [
    { kind: "file" as const, sha256: "a".repeat(64), store: "bunny", result: "deleted" as const },
    { kind: "text" as const, sha256: "b".repeat(64), store: "database", result: "cleared" as const },
  ],
};

describe("the deletion receipt", () => {
  it("verifies with the report's key and shows what was deleted, when and under which rule", () => {
    const { body } = issueDeletionReceipt(input, key);
    const v = verifyDeletionReceipt(body, key);
    expect(v.ok).toBe(true);
    if (!v.ok) {
      return;
    }
    expect(v.payload.schema).toBe(DELETION_RECEIPT_SCHEMA);
    expect(v.payload.rule).toBe("after-decision");
    expect(v.payload.deletedAt).toBe("2026-11-13T10:00:00.000Z");
    expect(v.payload.objects.map((o) => o.sha256)).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(v.keyId).toBe(key.keyId);
  });

  it("is deterministic: the same input and key give the same bytes", () => {
    expect(issueDeletionReceipt(input, key).body).toBe(issueDeletionReceipt(input, key).body);
  });

  it("holds no name and no personal field: only ids, kinds, hashes and a rule", () => {
    const { body } = issueDeletionReceipt(input, key);
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(JSON.parse(body));
    for (const banned of ["name", "email", "filename", "title", "tenant", "owner"]) {
      expect([...keys].filter((k) => k.toLowerCase().includes(banned))).toEqual([]);
    }
    expect(body).not.toMatch(/@/);
  });

  it("a tampered receipt does not verify (a hash, the rule, the date, the signature)", () => {
    const parsed = JSON.parse(issueDeletionReceipt(input, key).body);
    const mutate = (f: (p: typeof parsed) => void) => {
      const p = structuredClone(parsed);
      f(p);
      return JSON.stringify(p);
    };
    expect(
      verifyDeletionReceipt(
        mutate((p) => (p.payload.objects[0].sha256 = "c".repeat(64))),
        key,
      ),
    ).toMatchObject({
      ok: false,
      reason: "BAD_SIGNATURE",
    });
    expect(
      verifyDeletionReceipt(
        mutate((p) => (p.payload.rule = "window")),
        key,
      ),
    ).toMatchObject({ ok: false });
    expect(
      verifyDeletionReceipt(
        mutate((p) => (p.payload.deletedAt = "2026-01-01T00:00:00.000Z")),
        key,
      ),
    ).toMatchObject({ ok: false });
    expect(
      verifyDeletionReceipt(
        mutate((p) => (p.signature = crypto.randomBytes(64).toString("base64"))),
        key,
      ),
    ).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("is refused under another key, and when it is not a receipt", () => {
    expect(verifyDeletionReceipt(issueDeletionReceipt(input, key).body, other)).toMatchObject({
      ok: false,
      reason: "UNKNOWN_KEY",
    });
    expect(verifyDeletionReceipt("not json", key)).toMatchObject({ ok: false, reason: "NOT_A_RECEIPT" });
    expect(verifyDeletionReceipt('{"schema":"verikora.report/1"}', key)).toMatchObject({
      ok: false,
      reason: "NOT_A_RECEIPT",
    });
  });

  it("is recognised by its schema, so the verify path can pick it", () => {
    expect(receiptSchemaOf(issueDeletionReceipt(input, key).body)).toBe(true);
    expect(receiptSchemaOf("<html></html>")).toBe(false);
    expect(receiptSchemaOf('{"schema":"other"}')).toBe(false);
  });
});
