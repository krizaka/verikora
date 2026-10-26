import type { DocumentStore } from "./document-store";

/**
 * The test harness the contract runs in: `it` and `expect` of Vitest (the web, the Mac) or of Jest (the phone). Injected, so this file
 * imports neither: the same contract, whichever runner an app uses.
 */
export interface ContractHarness {
  it: (name: string, run: () => Promise<void>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the two runners' matchers share names, not types
  expect: (actual: unknown) => any;
}

/** What every DocumentStore adapter must do (ADR-0007): the same behaviour behind the same port. */
export function documentStoreContractWith(name: string, make: () => DocumentStore | Promise<DocumentStore>, { it, expect }: ContractHarness): void {
  const id = () => `contract/${Math.random().toString(36).slice(2)}/doc.pdf`;
  const bytes = () => new Uint8Array([37, 80, 68, 70, 0, 255, 1, 2, 3]);

  it(`${name}: keeps what it is given, byte for byte, with its content type`, async () => {
    const store = await make();
    const key = id();
    await store.put(key, bytes(), { contentType: "application/pdf" });
    const got = await store.get(key);
    expect(got).not.toBeNull();
    expect([...got!.bytes]).toEqual([...bytes()]);
    expect(got!.contentType).toBe("application/pdf");
    await store.delete(key);
  });

  it(`${name}: answers null for what is not there, and deleting it twice is fine`, async () => {
    const store = await make();
    const key = id();
    expect(await store.get(key)).toBeNull();
    await store.delete(key);
    await store.put(key, bytes(), { contentType: "text/plain" });
    await store.delete(key);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });

  it(`${name}: refuses a key that could leave its prefix, or that two adapters could read differently`, async () => {
    const store = await make();
    // A `.` segment is refused everywhere: a store that keeps files would see `a/./b.pdf` and `a/b.pdf` as one object, a Map as two.
    for (const bad of ["../x", "a/../b", "/abs", "a//b", "UPPER/case", "a/b/", "", "a/./b.pdf", "a/."]) await expect(store.put(bad, bytes(), { contentType: "text/plain" })).rejects.toMatchObject({ status: 400 });
  });

  it(`${name}: keeps a key and a longer key under it apart`, async () => {
    // Keys are names, not folders: `contract/x` and `contract/x/b.pdf` are two objects, whatever the adapter keeps them in.
    const store = await make();
    const short = id().replace(/\/doc\.pdf$/, "");
    const under = `${short}/b.pdf`;
    await store.put(short, new Uint8Array([1]), { contentType: "text/plain" });
    await store.put(under, new Uint8Array([2]), { contentType: "application/pdf" });
    expect([...(await store.get(short))!.bytes]).toEqual([1]);
    expect([...(await store.get(under))!.bytes]).toEqual([2]);
    await store.delete(short);
    expect(await store.get(under)).not.toBeNull();
    await store.delete(under);
  });

  it(`${name}: says where it lives`, async () => {
    const d = (await make()).describe();
    expect(["none", "database", "bunny", "s3", "device"]).toContain(d.kind);
    expect(typeof d.encrypted).toBe("boolean");
    expect(["canada", "elsewhere", "unknown", "device"]).toContain(d.residency);
  });
}
