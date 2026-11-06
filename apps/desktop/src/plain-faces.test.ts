import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/*
 * The Mac app is a product: plain Krizaka UI, never the Cahier's faces (decision of 2026-10-22, verikora#316). Those faces
 * are the tokens' defaults (`--kz-font-display`: Young Serif, `--kz-font-mono`: Courier Prime); the plain product faces
 * come from `@krizaka/ui/blocks.css`, under `[data-surface="product"]`. Without both, the window's headings fall back
 * to Georgia and its codes to Courier New. (krizaka-ui#632 asks to move them into the brand files.)
 */
const APP = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(APP, path), "utf8");
const blocks = readFileSync(createRequire(join(APP, "package.json")).resolve("@krizaka/ui/blocks.css"), "utf8");

describe("the Mac app wears the plain product faces", () => {
  it("imports @krizaka/ui/blocks.css after its own stylesheet (the tokens), so the product faces win", () => {
    const main = read("src/main.tsx");
    const blocksAt = main.indexOf('import "@krizaka/ui/blocks.css";');
    expect(blocksAt).toBeGreaterThan(-1);
    expect(blocksAt).toBeGreaterThan(main.indexOf('import "./styles.css";'));
  });

  it("marks its document as a product surface", () => {
    expect(read("index.html")).toMatch(/<html[^>]*\sdata-surface="product"/);
  });

  it("finds the product override of the faces in the installed blocks.css", () => {
    const rule = /:is\([^)]*\[data-surface="product"\][^)]*\)\s*\{[^}]*--kz-font-display:\s*var\(--kz-font-sans\)/.exec(
      blocks,
    );
    expect(rule).not.toBeNull();
  });
});
