import { describe, expect, it } from "vitest";

import { BRAND_ID } from "./brand";
import { MARK_URL, markDataUri } from "./og-mark";

describe("the social card's mark (#575)", () => {
  it("is the brand export on the media CDN, not a drawn shape", () => {
    expect(MARK_URL.endsWith(`/brand/${BRAND_ID}/logo-dark.svg`)).toBe(true);
  });
  it("becomes a data address of the exported mark", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const uri = await markDataUri((async () => new Response(svg)) as typeof fetch);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1] ?? "", "base64").toString()).toBe(svg);
  });
  it("fails when the CDN does not answer: no card without its mark", async () => {
    await expect(markDataUri((async () => new Response("", { status: 404 })) as typeof fetch)).rejects.toThrow(/404/);
  });
});
