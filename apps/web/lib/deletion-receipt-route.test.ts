import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETION_RULE, issueDeletionReceipt } from "./deletion-receipt";
import { signingKey } from "./report-signer";

/** krizaka-internal#3381: the receipt is downloaded by its owner and verified on /api/verify with the report's key. Only the database edge is faked. */
const MEMBER = { id: "22222222-2222-4222-8222-222222222222", email: "guest@example.test" };
const DOC = "33333333-3333-4333-8333-333333333333";
const RECEIPT_ID = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ owner: "" as string, audits: [] as Record<string, unknown>[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () => ({ account: MEMBER }),
}));
vi.mock("./audit", () => ({ audit: async (entry: Record<string, unknown>) => void state.audits.push(entry) }));
const { body } = issueDeletionReceipt(
  {
    receiptId: RECEIPT_ID,
    documentId: DOC,
    applicationId: null,
    rule: DELETION_RULE.afterCheck,
    deletedAt: new Date("2026-11-13T10:00:00Z"),
    objects: [{ kind: "file", sha256: "a".repeat(64), store: "none", result: "deleted" }],
  },
  signingKey(),
);
vi.mock("./db", () => ({
  query: async (text: string, values: unknown[]) =>
    text.includes("FROM deletion_receipts") && values.includes(state.owner) ? [{ body }] : [],
}));

const verify = async (text: string) => {
  const { POST } = await import("../app/api/verify/route");
  const form = new FormData();
  form.set("report", new File([text], "deletion-receipt.json", { type: "application/json" }));
  return POST(
    new Request("https://dev.verikora.com/api/verify", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
  );
};

describe("the deletion receipt on the verify path and its download", () => {
  beforeEach(() => {
    state.audits.length = 0;
    state.owner = MEMBER.id;
  });

  it("its owner downloads it as a JSON attachment, and no one else", async () => {
    const { GET } = await import("../app/api/documents/[id]/receipt/route");
    const res = await GET(new Request(`https://dev.verikora.com/api/documents/${DOC}/receipt`), {
      params: Promise.resolve({ id: DOC }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.text()).toBe(body);
    state.owner = "someone-else";
    const refused = await GET(new Request(`https://dev.verikora.com/api/documents/${DOC}/receipt`), {
      params: Promise.resolve({ id: DOC }),
    });
    expect(refused.status).toBe(404);
  });

  it("verifies the owner's receipt with the report's key and shows no name", async () => {
    const res = await verify(body);
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result).toMatchObject({
      kind: "deletion-receipt",
      ok: true,
      rule: "after-check",
      keyId: signingKey().keyId,
    });
    expect(state.audits.some((a) => a.action === "report.verified")).toBe(true);
  });

  it("a tampered receipt does not verify", async () => {
    const res = await verify(body.replace("after-check", "window"));
    expect((await res.json()).result).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("a valid receipt of another account is a 403, like an unknown report", async () => {
    state.owner = "someone-else";
    expect((await verify(body)).status).toBe(403);
  });
});
