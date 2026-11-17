import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stagedAppFiles } from "./routes.mjs";

const APP = join(__dirname, "..", "..", "app");
const OUT_OF_LIST =
  /sign-in|sign-up|(^|[\\/])api([\\/]|$)|download|terms|\(app\)|\(admin\)|rapport|dossier|screening|\[\.\.\.rest]|route\.ts|proxy/;

/** The public build links the REAL page files (never copies), and only the public ones (krizaka-internal#4148). */
describe("the files the public export is built from", () => {
  it("all exist in the app: one source for dev and the export", () => {
    for (const file of stagedAppFiles()) {
      expect(existsSync(join(APP, file)), file).toBe(true);
    }
  });

  it("hold no sign-in, no API, no download, no terms, no token page, no route handler", () => {
    for (const file of stagedAppFiles()) {
      expect(file).not.toMatch(OUT_OF_LIST);
    }
  });

  it("are the layout, the five pages and the assets", () => {
    expect(stagedAppFiles().filter((f) => f.endsWith("page.tsx"))).toEqual([
      join("[locale]", "page.tsx"),
      join("[locale]", "docs", "page.tsx"),
      join("[locale]", "pricing", "page.tsx"),
      join("[locale]", "contact", "page.tsx"),
      join("[locale]", "privacy", "page.tsx"),
    ]);
  });
});
