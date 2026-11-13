import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pages' half of the authorization matrix (krizaka-internal#2382): `PAGES_ACCESS` puts every page of the signed-in space and of
 * the administration under the layout that locks it (`authorization-coverage.test.ts`); this proves the two layouts hold their locks.
 * The administration answers a member, or an administrator from a foreign address, with a 404 (it does not announce itself).
 */
const gate = vi.hoisted(() => ({
  session: null as null | { account: { id: string; email: string } },
  admin: false,
}));
vi.mock("@/lib/access", () => ({
  pageSession: async () => gate.session,
  pageAdmin: async () => (gate.admin ? gate.session : null),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: () => null }));

const params = Promise.resolve({ locale: "en" });
const member = { account: { id: "00000000-0000-4000-8000-000000000001", email: "member@verikora.test" } };

describe("the layouts hold the pages' locks (krizaka-internal#2382)", () => {
  beforeEach(() => {
    gate.session = null;
    gate.admin = false;
  });

  it("the administration: anonymous goes to sign-in, a member gets a 404, an administrator gets the page", async () => {
    const { default: SignedAdmin } = await import("@/app/[locale]/(admin)/console/(signed)/layout");
    await expect(SignedAdmin({ children: null, params })).rejects.toThrow("REDIRECT /en/sign-in");
    gate.session = member;
    await expect(SignedAdmin({ children: null, params })).rejects.toThrow("NOT_FOUND");
    gate.admin = true;
    await expect(SignedAdmin({ children: null, params })).resolves.toBeTruthy();
  });

  it("the signed-in space: anonymous goes to sign-in", async () => {
    const { default: ConsoleLayout } = await import("@/app/[locale]/(app)/app/layout");
    await expect(ConsoleLayout({ children: null, params })).rejects.toThrow("REDIRECT /en/sign-in");
  });
});
