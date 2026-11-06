import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

import sitemap from "../app/sitemap";
import { proxy } from "../proxy";
import { downloadPageOpen } from "./downloads";
import { PRICING_PUBLIC } from "./prices/publication";
import { SITE_URL } from "./site";

/** The sitemap lists every indexable page in both languages, each the other's hreflang alternate — and is served when indexing is on. */
describe("sitemap.xml", () => {
  let entries: Awaited<ReturnType<typeof sitemap>> = [];
  let urls: string[] = [];
  beforeAll(async () => {
    entries = await sitemap();
    urls = entries.map((e) => e.url);
  });

  it("lists the home, docs, privacy, terms and contact, in en and fr, /pricing while published and /download only while it has an app or a video, nothing else", () => {
    const paths = [
      "",
      "/docs",
      "/privacy",
      "/terms",
      "/contact",
      ...(PRICING_PUBLIC ? ["/pricing"] : []),
      ...(downloadPageOpen() ? ["/download"] : []),
    ];
    for (const locale of ["en", "fr"]) for (const path of paths) expect(urls).toContain(`${SITE_URL}/${locale}${path}`);
    expect(urls).toHaveLength(2 * paths.length);
  });

  it("lists none of the removed addresses", () => {
    expect(
      urls.filter((u) =>
        /\/(run|changelog|tenant|landlord|freelancer|business|locataire|proprietaire|travailleur-autonome|entreprise)$/.test(
          u,
        ),
      ),
    ).toEqual([]);
  });

  it("gives every entry en, fr and x-default alternates", () => {
    for (const e of entries)
      expect(Object.keys(e.alternates?.languages ?? {}).sort()).toEqual(["en", "fr", "x-default"]);
  });

  it("points x-default to the French page: French is the default language (yomizaka#366)", () => {
    for (const e of entries) expect(e.alternates?.languages?.["x-default"]).toBe(e.alternates?.languages?.fr);
  });

  it("does not list the report checker (in the app, not public) nor a parked /download", () => {
    expect(urls.filter((u) => u.includes("/verify") || (!downloadPageOpen() && u.includes("/download")))).toEqual([]);
  });
});

describe("the proxy serves /sitemap.xml and /robots.txt only when the deployment is indexed", () => {
  const ask = (path: string, host = "www.yomizaka.com") =>
    proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  const before = process.env.APP_SEARCH_INDEXING;
  const restore = () =>
    before === undefined ? delete process.env.APP_SEARCH_INDEXING : (process.env.APP_SEARCH_INDEXING = before);

  it("on: the commercial host passes the request through to the generated sitemap (no 404, no noindex); www.yomizaka.com never does", async () => {
    process.env.APP_SEARCH_INDEXING = "on";
    try {
      expect(ask("/sitemap.xml", "www.yomizaka.com").status).toBe(404);
      const res = ask("/sitemap.xml", "www.verikora.com");
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag")).toBeNull();
    } finally {
      restore();
    }
  });

  it("on: a dev.* host never serves it (krizaka/yomizaka#239)", async () => {
    process.env.APP_SEARCH_INDEXING = "on";
    try {
      const res = ask("/sitemap.xml", "dev.yomizaka.com");
      expect(res.status).toBe(404);
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
    } finally {
      restore();
    }
  });

  it("off: answers 404 and a closed robots.txt", async () => {
    process.env.APP_SEARCH_INDEXING = "off";
    try {
      expect(ask("/sitemap.xml", "staging.example.test").status).toBe(404);
      expect(await ask("/robots.txt", "staging.example.test").text()).toContain("Disallow: /");
    } finally {
      restore();
    }
  });
});
