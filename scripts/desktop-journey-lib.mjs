// The pure parts of the Mac journey (verikora#636, ADR-017): where the app keeps its folder scope, what a pre-granted scope
// looks like, and the small W3C client of the embedded WebDriver (tauri-plugin-webdriver, 127.0.0.1:4445). No dependency.
import { join } from "node:path";

export const IDENTIFIER = "com.krizaka.verikora.desktop";
export const WEBDRIVER = "http://127.0.0.1:4445";
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

/** Where the kit (krizaka-tauri-kit `ScopeStore`) persists the granted folders on a Mac. */
export const scopeFile = (home) => join(home, "Library", "Application Support", IDENTIFIER, "scope.json");

/** The scope the kit loads: `{"roots":[…]}`. It drops a root that is gone or not grantable (the home, `/`, `/tmp`, `/var`). */
export const scopeJson = (roots) => `${JSON.stringify({ roots }, null, 2)}\n`;

/** The route of a folder in the app (`#/library/<folder>`), the same as the library's links. */
export const libraryHash = (folder) => `#/library/${encodeURIComponent(folder)}`;

/** The id inside a W3C element reference. */
export const elementId = (reference) => reference?.[ELEMENT] ?? reference?.ELEMENT;

/** A client of the WebDriver server inside the app: sessions, elements, scripts, screenshots. */
export function client(base = WEBDRIVER, fetchImpl = fetch) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(`webdriver ${method} ${path}: HTTP ${res.status} ${json?.value?.message ?? ""}`.trim());
    return json.value;
  };
  return {
    async start() {
      const session = await call("POST", "/session", { capabilities: { alwaysMatch: {} } });
      const sid = session.sessionId;
      const at = (path) => `/session/${sid}${path}`;
      return {
        sid,
        find: async (css) => elementId(await call("POST", at("/element"), { using: "css selector", value: css })),
        exists: async (css) => (await call("POST", at("/elements"), { using: "css selector", value: css })).length > 0,
        click: (id) => call("POST", at(`/element/${id}/click`), {}),
        type: (id, text) => call("POST", at(`/element/${id}/value`), { text }),
        run: (script, ...args) => call("POST", at("/execute/sync"), { script, args }),
        hash: () => call("POST", at("/execute/sync"), { script: "return window.location.hash", args: [] }),
        screenshot: () => call("GET", at("/screenshot")),
        rect: () => call("GET", at("/window/rect")),
        quit: () => call("DELETE", `/session/${sid}`),
      };
    },
  };
}

/** Waits until `check` answers truthy, polling; the error names what was awaited (a stable sentence for the log). */
export async function until(
  what,
  check,
  { timeoutMs, everyMs = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {},
) {
  const deadline = now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (now() >= deadline) throw new Error(`timed out waiting for ${what}${last ? ` (${last.message})` : ""}`);
    await sleep(everyMs);
  }
}
