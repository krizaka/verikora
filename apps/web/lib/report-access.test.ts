import { describe, expect, it } from "vitest";

import { accessTo, type Grant, referenceOf, type Target } from "./report-access";

const NOW = new Date("2026-10-17T12:00:00Z");
const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "g",
  email: "guest@x.test",
  createdAt: new Date("2026-10-01"),
  expiresAt: null,
  revokedAt: null,
  ...over,
});
const target = (grants: Grant[]): Target => ({ analysisId: "a", documentId: "d", ownerId: "owner", grants });
const guest = { id: "guest-id", email: "guest@x.test" };

describe("accessTo", () => {
  it("the owner always has access", () =>
    expect(accessTo(target([]), { id: "owner", email: "o@x.test" }, NOW)).toEqual({ allowed: true, via: "owner" }));
  it("a live grant gives access", () =>
    expect(accessTo(target([grant()]), guest, NOW)).toEqual({ allowed: true, via: "grant", grantId: "g" }));
  it("no grant, no access", () => expect(accessTo(target([]), guest, NOW)).toEqual({ allowed: false }));
  it("a revoked grant gives nothing", () =>
    expect(accessTo(target([grant({ revokedAt: new Date("2026-10-05") })]), guest, NOW).allowed).toBe(false));
  it("an expired grant gives nothing, one expiring later gives access", () => {
    expect(accessTo(target([grant({ expiresAt: new Date("2026-10-17T11:59:59Z") })]), guest, NOW).allowed).toBe(false);
    expect(accessTo(target([grant({ expiresAt: new Date("2026-10-18") })]), guest, NOW).allowed).toBe(true);
  });
  it("an invitation (no account yet) is honoured the moment an account with that address exists", () => {
    expect(accessTo(target([grant({ email: "new@x.test" })]), { id: "later", email: "New@X.test" }, NOW).allowed).toBe(
      true,
    );
  });
});

describe("referenceOf", () => {
  const sha = "a".repeat(64);
  const file = (json: string) =>
    `<html><script type="application/json" id="verikora-attestation">${json}</script></html>`;
  it("reads the run id and the document hash a report claims", () => {
    expect(
      referenceOf(file(JSON.stringify({ payload: { check: { runId: "r1" }, document: { sha256: sha } } }))),
    ).toEqual({ runId: "r1", documentSha256: sha });
  });
  it("is null for anything else", () => {
    expect(referenceOf("<html></html>")).toBeNull();
    expect(referenceOf(file("{nope"))).toBeNull();
    expect(
      referenceOf(file(JSON.stringify({ payload: { check: { runId: "r1" }, document: { sha256: "short" } } }))),
    ).toBeNull();
  });
});
