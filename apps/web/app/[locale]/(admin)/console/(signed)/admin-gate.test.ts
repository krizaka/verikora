import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

/**
 * Every page of the signed console checks the administrator itself, before it reads anything: the layout's lock is not the only one
 * (a page segment can be rendered without its layout). The pages are read from the disk, so a new page is held to it on arrival.
 */

const REFUSED = new Error("refused by requirePageAdmin");
const guard = vi.fn(async () => {
  throw REFUSED;
});
vi.mock("@/lib/access", async (actual) => ({ ...(await actual<object>()), requirePageAdmin: guard }));

const here = import.meta.dirname;
const pages = (readdirSync(here, { recursive: true, encoding: "utf8" }) as string[])
  .filter((file) => file.endsWith("page.tsx"))
  .map((file) => relative(here, join(here, file)))
  .sort();

const props = {
  params: Promise.resolve({ locale: "en", id: "00000000-0000-4000-8000-000000000001", group: "general" }),
};

describe("the signed console pages", () => {
  it("are found on the disk", () => {
    expect(pages.length).toBeGreaterThanOrEqual(13);
  });

  it.each(pages)("%s refuses a caller who is not an administrator before it reads anything", async (page) => {
    guard.mockClear();
    const { default: render } = (await import(pathToFileURL(join(here, page)).href)) as {
      default: (p: typeof props) => unknown;
    };
    await expect(Promise.resolve().then(() => render(props))).rejects.toBe(REFUSED);
    expect(guard).toHaveBeenCalledTimes(1);
  });
});
