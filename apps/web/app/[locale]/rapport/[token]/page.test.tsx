import { beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => ({ report: null as unknown }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.5" }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/owner-report-shares", () => ({ openShare: async () => open.report }));
vi.mock("@/components/SiteChrome", () => ({ SiteHeader: () => null }));
vi.mock("@/components/SiteFooter", () => ({ ProductFooter: () => null }));

import OwnerReportPage from "./page";

const params = (token: string) => ({
  params: Promise.resolve({ locale: "fr", token }),
  searchParams: Promise.resolve({}),
});

beforeEach(() => {
  open.report = null;
});

describe("/rapport/<token> (verikora#128)", () => {
  it("a revoked, expired or unknown link is a 404, never the report", async () => {
    await expect(OwnerReportPage(params("revoked-token"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a live link renders the report", async () => {
    open.report = {
      reference: "DOS-1",
      issuedAt: "2026-10-27T12:00:00.000Z",
      expiresAt: "2026-11-03T12:00:00.000Z",
      documents: [],
      rulesets: [],
    };
    await expect(OwnerReportPage(params("live-token"))).resolves.toBeTruthy();
  });
});
