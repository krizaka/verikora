import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** `pnpm build:public` died on an import of a removed export (krizaka-internal#4623): every named import of a sibling script must exist. */
describe("build-public.mjs imports", () => {
  it("imports only what check-public-export.mjs exports", async () => {
    const source = readFileSync(resolve(__dirname, "../../scripts/build-public.mjs"), "utf8");
    const named = /import \{([^}]+)\} from "\.\/check-public-export\.mjs"/.exec(source)?.[1] ?? "";
    const names = named
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const exported = await import("../../scripts/check-public-export.mjs");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(Object.keys(exported)).toContain(name);
  });
});
