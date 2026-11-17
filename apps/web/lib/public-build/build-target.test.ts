import { afterEach, describe, expect, it, vi } from "vitest";

/** What the public target changes in the one-line differences (krizaka-internal#4148): no API section, no terms, no download, no notice. */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function underTarget(target: string) {
  vi.stubEnv("NEXT_PUBLIC_BUILD_TARGET", target);
  vi.resetModules();
  const [{ docsSections }, { isListed }] = await Promise.all([import("../docs"), import("../listed")]);
  return { docsSections, isListed };
}

describe("the public target", () => {
  it("drops the API section of the docs and the terms and download pages", async () => {
    const { docsSections, isListed } = await underTarget("public");
    expect(docsSections()).toEqual(["check", "data"]);
    expect(isListed("terms")).toBe(false);
    expect(isListed("download")).toBe(false);
    expect(isListed("pricing")).toBe(true);
  });

  it("leaves the dev app as it was", async () => {
    const { docsSections, isListed } = await underTarget("");
    expect(docsSections()).toEqual(["check", "api", "data"]);
    expect(isListed("terms")).toBe(true);
  });
});
