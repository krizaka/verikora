import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { localStore } from "./local";

const dir = mkdtempSync(join(tmpdir(), "verikora-local-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("localStore (the working store of a laptop and of the tests)", () => {
  // The shared contract also asks a key and a longer key under it to coexist; a disk cannot (a file is not a folder). Keys here are always <owner>/<document>/original.<ext>.
  it("is development only, keeps nothing for the person, and puts bytes on disk under the given folder", async () => {
    const store = localStore(dir);
    expect(store.describe()).toMatchObject({ kind: "none", devOnly: true, owner: "krizaka" });
    await store.put("a1/b2/original.txt", new TextEncoder().encode("bail"), { contentType: "text/plain" });
    expect(new TextDecoder().decode((await store.get("a1/b2/original.txt"))!.bytes)).toBe("bail");
    await store.delete("a1/b2/original.txt");
    expect(await store.get("a1/b2/original.txt")).toBeNull();
  });
});
