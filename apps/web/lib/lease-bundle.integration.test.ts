import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { attachToLease, detachFromLease, DOCUMENT_ROLE, leaseBundle, MAX_ANNEXES } from "./lease-bundle";

/** verikora#129 against the real database (CI's service; locally DATABASE_IT=1 DATABASE_URL=…). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("a lease and its annexes (verikora#129)", () => {
  const stamp = Date.now();
  let seq = 0;
  let a: string;
  let b: string;
  const doc = async (owner: string, title: string) => {
    const [row] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, text) VALUES ($1, $2, $2, 'text/plain', 'lease', 5, $3, 'x'::bytea, 'x') RETURNING id",
      [owner, title, `${stamp}-${++seq}`],
    );
    return row!.id;
  };
  const checked = (documentId: string, ruleId: string, line: number) =>
    query(
      "INSERT INTO analyses (document_id, studio, status, report) VALUES ($1, 'compliance-check', 'succeeded', $2)",
      [
        documentId,
        JSON.stringify({
          rulesetId: "qc-residential-lease",
          rulesetVersion: "1.0.0",
          jurisdiction: "CA-QC",
          asOf: "2026-10-28",
          reviewStatus: "TO_REVIEW_BY_LAWYER",
          findings: [
            {
              ruleId,
              severity: "BLOCKING",
              verdict: "FAIL",
              explanation: "x",
              citation: "art. 1",
              line,
              evidenceSpan: { quote: "q" },
            },
          ],
        }),
      ],
    );

  beforeAll(async () => {
    await migrate();
    const ids = await Promise.all(
      [`bundle-a-${stamp}@verikora.test`, `bundle-b-${stamp}@verikora.test`].map(
        async (email) =>
          (await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [email]))[0]!.id,
      ),
    );
    [a, b] = ids as [string, string];
  });
  afterAll(async () => {
    await query("DELETE FROM accounts WHERE id = ANY($1)", [[a, b]]);
  });

  it("reads one lease and its annexes as one list, and a detached annex leaves it", async () => {
    const lease = await doc(a, "lease");
    const annex = await doc(a, "annex");
    const rules = await doc(a, "rules");
    await attachToLease(a, lease, annex, DOCUMENT_ROLE.annex);
    await attachToLease(a, lease, rules, DOCUMENT_ROLE.buildingRules);
    await checked(lease, "R-LEASE", 4);
    await checked(annex, "R-ANNEX", 2);
    const bundle = await leaseBundle(a, lease);
    expect(bundle.documents.map((d) => d.role)).toEqual(["lease", "annex", "building-rules"]);
    expect(bundle.lines.map((l) => [l.documentId, l.ruleId, l.line])).toEqual([
      [lease, "R-LEASE", 4],
      [annex, "R-ANNEX", 2],
    ]);
    expect(bundle.rulesets[0]?.reviewStatus).toBe("TO_REVIEW_BY_LAWYER");
    await detachFromLease(a, lease, annex);
    expect((await leaseBundle(a, lease)).documents.map((d) => d.id)).toEqual([lease, rules]);
  });

  it("refuses what is not the person's, an annex of an annex, a lease with annexes as an annex, and too many annexes", async () => {
    const lease = await doc(a, "l2");
    const annex = await doc(a, "a2");
    const other = await doc(b, "other");
    await expect(attachToLease(a, lease, other, DOCUMENT_ROLE.annex)).rejects.toMatchObject({ status: 404 });
    await expect(leaseBundle(b, lease)).rejects.toMatchObject({ status: 404 });
    await expect(attachToLease(a, lease, lease, DOCUMENT_ROLE.annex)).rejects.toMatchObject({ status: 400 });
    await attachToLease(a, lease, annex, DOCUMENT_ROLE.annex);
    await expect(attachToLease(a, annex, await doc(a, "x"), DOCUMENT_ROLE.annex)).rejects.toMatchObject({
      status: 409,
    });
    await expect(attachToLease(a, await doc(a, "l3"), lease, DOCUMENT_ROLE.annex)).rejects.toMatchObject({
      status: 409,
    });
    await expect(detachFromLease(b, lease, annex)).rejects.toMatchObject({ status: 404 });
    for (let i = 1; i < MAX_ANNEXES; i += 1) await attachToLease(a, lease, await doc(a, `n${i}`), DOCUMENT_ROLE.annex);
    await expect(attachToLease(a, lease, await doc(a, "last"), DOCUMENT_ROLE.annex)).rejects.toMatchObject({
      status: 409,
    });
  });
});
