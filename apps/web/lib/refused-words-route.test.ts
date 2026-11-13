import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "./limits";

const state = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "USER" | null,
  words: { fr: ["fraude"], en: ["fraud", "liar"] } as Record<string, string[]>,
  audits: [] as { action: string; detail: unknown }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () =>
    state.role
      ? {
          id: "s1",
          account: { id: "22222222-2222-4222-8222-222222222222", email: "admin@verikora.test", role: state.role },
        }
      : null,
}));
vi.mock("./audit", () => ({
  audit: async (e: { action: string; detail: unknown }) => void state.audits.push(e),
}));
vi.mock("./db", () => {
  const run = async (text: string, values: string[] = []) => {
    const [language, word] = values;
    if (text.startsWith("SELECT language, word")) {
      return Object.entries(state.words).flatMap(([l, ws]) => ws.map((w) => ({ language: l, word: w })));
    }
    if (text.startsWith("INSERT")) {
      if (state.words[language!]!.includes(word!)) {
        return [];
      }
      state.words[language!]!.push(word!);
      return [{ word }];
    }
    if (text.startsWith("SELECT word")) {
      return state.words[language!]!.map((w) => ({ word: w }));
    }
    if (text.startsWith("DELETE")) {
      state.words[language!] = state.words[language!]!.filter((w) => w !== word);
    }
    return [];
  };
  return { query: run, transaction: async (work: (q: typeof run) => unknown) => work(run) };
});

const call = (method: "GET" | "POST" | "DELETE", body?: unknown) =>
  new Request("https://admin.verikora.com/api/admin/refused-words", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.20", "content-type": "application/json" },
  });

beforeEach(() => {
  resetRateLimits();
  state.role = "ADMIN";
  state.words = { fr: ["fraude"], en: ["fraud", "liar"] };
  state.audits = [];
});

describe("the refused-word list API is the administration's only", () => {
  it.each([null, "USER"] as const)("refuses %s", async (role) => {
    state.role = role;
    const { GET, POST, DELETE } = await import("../app/api/admin/refused-words/route");
    const expected = role ? 403 : 401;
    expect((await GET(call("GET"))).status).toBe(expected);
    expect((await POST(call("POST", { language: "en", word: "cheat" }))).status).toBe(expected);
    expect((await DELETE(call("DELETE", { language: "en", word: "liar" }))).status).toBe(expected);
    expect(state.words.en).toEqual(["fraud", "liar"]);
  });

  it("lists, adds and removes a word, one audit line each", async () => {
    const { GET, POST, DELETE } = await import("../app/api/admin/refused-words/route");
    expect(await (await GET(call("GET"))).json()).toEqual({ fr: ["fraude"], en: ["fraud", "liar"] });
    expect((await POST(call("POST", { language: "en", word: "Cheater" }))).status).toBe(201);
    expect(state.words.en).toContain("cheater");
    expect((await DELETE(call("DELETE", { language: "en", word: "liar" }))).status).toBe(200);
    expect(state.words.en).not.toContain("liar");
    expect(state.audits.map((a) => a.action)).toEqual(["report_refused_word.added", "report_refused_word.removed"]);
  });

  it.each([
    ["an empty word", { language: "en", word: " " }, 422],
    ["a sentence", { language: "en", word: "one two three four five" }, 422],
    ["a language that does not exist", { language: "de", word: "betrug" }, 400],
    ["a word already listed", { language: "en", word: "fraud" }, 409],
  ])("refuses %s", async (_name, body, status) => {
    const { POST } = await import("../app/api/admin/refused-words/route");
    expect((await POST(call("POST", body))).status).toBe(status);
  });

  it("keeps the last word of a language, and says so", async () => {
    const { DELETE } = await import("../app/api/admin/refused-words/route");
    const res = await DELETE(call("DELETE", { language: "fr", word: "fraude" }));
    expect(res.status).toBe(409);
    expect(state.words.fr).toEqual(["fraude"]);
  });
});
