import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BROWSE_BUTTON_TARGET, EXPAND_BUTTON_TARGET } from "./phone-targets";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the 44 px targets of the phone (krizaka-internal#3972)", () => {
  it("every drop area lifts its « Choose files » button to 44 px", () => {
    for (const file of ["./LibraryDrop.tsx", "./DocumentUploader.tsx", "./BatchImport.tsx"]) {
      expect(read(file), file).toMatch(/<Dropzone[^>]*\s+className=\{BROWSE_BUTTON_TARGET\}/);
    }
    expect(BROWSE_BUTTON_TARGET).toMatch(/min-h-11/);
  });

  it("every console table lifts its row expand button to 44 px", () => {
    for (const file of ["./DocumentTable.tsx", "./FilesView.tsx", "./ChecksView.tsx"]) {
      expect(read(file), file).toMatch(/className=\{EXPAND_BUTTON_TARGET\}/);
    }
    expect(EXPAND_BUTTON_TARGET).toMatch(/min-h-11/);
    expect(EXPAND_BUTTON_TARGET).toMatch(/min-w-11/);
  });
});

describe("no dashed drop area on the Mac home (krizaka-internal#3972)", () => {
  it("the library's empty state is not dashed", () => {
    expect(read("../../../desktop/src/components/Library.tsx")).toMatch(/<EmptyState[\s\S]*?className="[^"]*border-0/);
  });

  it("the stylesheet draws no dashed outline", () => {
    expect(read("../../../desktop/src/styles.css")).not.toMatch(/dashed/);
  });
});
