import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

/*
 * A @krizaka/ui component is only as styled as the stylesheet the app imports for it (verikora#316). Most components are
 * Tailwind classes (`@krizaka/ui/tailwind.css`) or page blocks (`blocks.css`, imported by the locale layout); the story
 * blocks (`ChoiceGrid`, `ScrollStage`…) draw `kzs-*` classes that only `@krizaka/ui/story.css` styles. The kind picker of
 * /app/check shipped unstyled because nothing imported it (it is `ChoiceCards` since verikora#318). This test reads every @krizaka/ui module the app imports and
 * refuses one whose built code uses `kzs-` classes while no source file imports `@krizaka/ui/story.css`.
 */
const WEB = join(import.meta.dirname, "..");
const require = createRequire(join(WEB, "package.json"));
const DIST = dirname(require.resolve("@krizaka/ui/blocks.css"));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = ["app", "components", "lib"].flatMap((d) => sources(join(WEB, d)));
const code = files.map((f) => readFileSync(f, "utf8"));
const imported = new Set(
  code.flatMap((src) => [...src.matchAll(/from "@krizaka\/ui\/([a-z0-9-]+)"/g)].map((m) => m[1]!)),
);
const storyImported = code.some((src) => /import "@krizaka\/ui\/story\.css"/.test(src));

describe("@krizaka/ui stylesheets the app needs", () => {
  it("reads the app's imports (the test sees the page blocks and the account settings)", () => {
    expect(imported).toContain("page-header");
    expect(imported).toContain("account-settings");
  });

  it("imports story.css when an imported component draws kzs-* classes", () => {
    const needsStory = [...imported].filter((name) => {
      try {
        return /["'\s]kzs-/.test(readFileSync(join(DIST, `${name}.js`), "utf8"));
      } catch {
        return false;
      }
    });
    expect(needsStory.length === 0 || storyImported, `story.css is needed by: ${needsStory.join(", ")}`).toBe(true);
  });
});
