import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "../limits";
import { resetAppSettings } from "./instance";

const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "USER",
  stored: undefined as boolean | undefined,
  writes: [] as { text: string; values: unknown[] }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("../session", async (orig) => ({
  ...(await orig<typeof import("../session")>()),
  resolveSession: async () => ({
    id: "s1",
    account: {
      id: ADMIN_ID,
      email: "admin@verikora.test",
      role: state.role,
      locale: "fr",
      perspective: null,
      name: null,
      avatarSeed: null,
    },
  }),
}));
vi.mock("../audit", () => ({ audit: async () => undefined }));
vi.mock("../db", () => ({
  query: async (text: string, values: unknown[] = []) => {
    const rows = state.stored === undefined ? [] : [{ key: "signup.open", value: state.stored }];
    if (/^SELECT (key, )?value FROM app_settings/.test(text)) {
      return rows;
    }
    if (/^(INSERT|DELETE)/.test(text)) {
      state.writes.push({ text, values });
    }
    return [];
  },
}));

const put = (value: unknown) =>
  new Request("https://admin.verikora.com/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify({ scope: "global", key: "signup.open", value }),
    headers: { "x-forwarded-for": "203.0.113.20", "content-type": "application/json" },
  });

beforeEach(() => {
  resetRateLimits();
  resetAppSettings();
  state.role = "ADMIN";
  state.stored = undefined;
  state.writes = [];
});

describe("the « Sign-up open » switch", () => {
  it("is changed by an administrator, and the change is audited (who, when, old → new)", async () => {
    state.stored = false;
    const { PUT } = await import("../../app/api/admin/settings/route");
    expect((await PUT(put(true))).status).toBe(200);
    const audit = state.writes.find((w) => w.text.startsWith("INSERT INTO settings_audit"));
    expect(audit).toBeDefined();
    const [at, actorId, actorLabel, scope, , key, before, after] = audit?.values ?? [];
    expect(at).toBeInstanceOf(Date);
    expect({ actorId, actorLabel, scope, key, before, after }).toEqual({
      actorId: ADMIN_ID,
      actorLabel: "admin@verikora.test",
      scope: "global",
      key: "signup.open",
      before: "false",
      after: "true",
    });
  });

  it("is refused to a member: 403, nothing written", async () => {
    state.role = "USER";
    const { PUT } = await import("../../app/api/admin/settings/route");
    expect((await PUT(put(true))).status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it("refuses a value that is not a boolean", async () => {
    const { PUT } = await import("../../app/api/admin/settings/route");
    expect((await PUT(put("yes"))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
});
