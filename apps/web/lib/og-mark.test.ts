import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { MARK_FILE, markDataUri } from "./og-mark";

describe("the social card's mark (#575, #1998)", () => {
  it("is a committed file of the brand export, not a drawn shape", async () => {
    expect((await readFile(MARK_FILE, "utf8")).includes("<svg")).toBe(true);
  });
  it("becomes a data address of the exported mark, without any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "og-")), "mark.svg");
    await writeFile(file, svg);
    const uri = await markDataUri(file);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1] ?? "", "base64").toString()).toBe(svg);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("fails when the file is missing: no card without its mark", async () => {
    await expect(markDataUri("/nonexistent/mark.svg")).rejects.toThrow(/missing/);
  });
});
