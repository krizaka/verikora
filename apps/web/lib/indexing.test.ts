import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOSED_ROBOTS, devRedirect, indexable, indexableOn, isDevHost, NOINDEX_HEADER, publicHost } from "./indexing";

afterEach(() => vi.unstubAllEnvs());

const ask = async (url: string, host: string) => {
  const { proxy } = await import("../proxy");
  return proxy(new NextRequest(url, { headers: { host } }));
};

describe("APP_SEARCH_INDEXING — one flag closes a deployment to search engines", () => {
  it("is on by default and off only when set to off", () => {
    expect(indexable({})).toBe(true);
    expect(indexable({ APP_SEARCH_INDEXING: "on" })).toBe(true);
    expect(indexable({ APP_SEARCH_INDEXING: "OFF" })).toBe(false);
  });

  it("off: robots.txt disallows everything and names no sitemap; sitemap.xml is 404; every response says noindex", async () => {
    vi.stubEnv("APP_SEARCH_INDEXING", "off");
    const robots = await ask("https://dev.yomizaka.com/robots.txt", "dev.yomizaka.com");
    expect(await robots.text()).toBe(CLOSED_ROBOTS);
    expect(CLOSED_ROBOTS).not.toMatch(/sitemap/i);
    expect(robots.headers.get("x-robots-tag")).toBe(NOINDEX_HEADER);
    expect((await ask("https://dev.yomizaka.com/sitemap.xml", "dev.yomizaka.com")).status).toBe(404);
    for (const path of ["/", "/en", "/fr/verify", "/api/healthz", "/api/verify"]) {
      const res = await ask(`https://dev.yomizaka.com${path}`, "dev.yomizaka.com");
      expect(res.headers.get("x-robots-tag"), path).toBe(NOINDEX_HEADER);
    }
  });

  it("on: the commercial host is open; a dev.* host is closed anyway, even without APP_DEV_HOST (krizaka/yomizaka#239)", async () => {
    vi.stubEnv("APP_SEARCH_INDEXING", "on");
    vi.stubEnv("APP_DEV_HOST", "");
    vi.stubEnv("APP_PUBLIC_URL", "https://www.verikora.com");
    const www = await ask("https://www.verikora.com/en", "www.verikora.com");
    expect(www.headers.get("x-robots-tag")).toBeNull();
    expect(indexableOn("www.verikora.com")).toBe(true);
    for (const host of ["dev.yomizaka.com", "dev.example.test"]) {
      expect(indexableOn(host), host).toBe(false);
      const res = await ask(`https://${host}/en`, host);
      expect(res.headers.get("x-robots-tag"), host).toBe(NOINDEX_HEADER);
      expect(await (await ask(`https://${host}/robots.txt`, host)).text(), host).toBe(CLOSED_ROBOTS);
      expect((await ask(`https://${host}/sitemap.xml`, host)).status, host).toBe(404);
    }
  });

  it("the console host is closed whatever the flag, redirects included", async () => {
    vi.stubEnv("APP_SEARCH_INDEXING", "on");
    const redirect = await ask("https://admin.yomizaka.com/", "admin.yomizaka.com");
    expect(redirect.status).toBeGreaterThanOrEqual(300);
    expect(redirect.headers.get("x-robots-tag")).toBe(NOINDEX_HEADER);
    expect(await (await ask("https://admin.yomizaka.com/robots.txt", "admin.yomizaka.com")).text()).toBe(CLOSED_ROBOTS);
  });
});

const ENV = {
  APP_SEARCH_INDEXING: "off",
  APP_PUBLIC_URL: "https://www.yomizaka.com",
  APP_DEV_HOST: "dev.yomizaka.com",
};

describe("the public host is indexed, the dev host never (epic krizaka/.github#119)", () => {
  it("a closed deployment (off) stays closed everywhere but on the commercial host of APP_PUBLIC_URL; a code-name host is never open", () => {
    const commercial = { ...ENV, APP_PUBLIC_URL: "https://www.verikora.com" };
    expect(publicHost(ENV)).toBe("www.yomizaka.com");
    expect(indexableOn("www.yomizaka.com", ENV)).toBe(false);
    expect(indexableOn("www.verikora.com", commercial)).toBe(true);
    expect(indexableOn("WWW.verikora.com:443", commercial)).toBe(true);
    expect(indexableOn("dev.yomizaka.com", ENV)).toBe(false);
    expect(indexableOn("admin.yomizaka.com", ENV)).toBe(false);
    expect(indexableOn("anything.test", ENV)).toBe(false);
    expect(indexableOn("dev.yomizaka.com", { APP_SEARCH_INDEXING: "on" })).toBe(false);
    expect(indexableOn("www.yomizaka.com", { APP_SEARCH_INDEXING: "on" })).toBe(false);
    expect(indexableOn("www.verikora.com", { APP_SEARCH_INDEXING: "on" })).toBe(true);
  });

  it("the dev host is the one APP_DEV_HOST names", () => {
    expect(isDevHost("dev.yomizaka.com", ENV)).toBe(true);
    expect(isDevHost("www.yomizaka.com", ENV)).toBe(false);
    expect(isDevHost("dev.yomizaka.com", {})).toBe(false);
  });

  it("on the dev host every HTML page goes to www (308 target, same path and query); the API, auth, webhooks, .well-known, healthz and robots stay", () => {
    const go = (path: string, method = "GET") =>
      devRedirect(
        method,
        path.split("?")[0]!,
        path.includes("?") ? `?${path.split("?")[1]}` : "",
        "https://www.yomizaka.com",
      );
    expect(go("/en")).toBe("https://www.yomizaka.com/en");
    expect(go("/en/sign-in?next=%2Fapp")).toBe("https://www.yomizaka.com/en/sign-in?next=%2Fapp");
    expect(go("/")).toBe("https://www.yomizaka.com/");
    expect(go("/sitemap.xml")).toBe("https://www.yomizaka.com/sitemap.xml");
    expect(go("/en", "HEAD")).toBe("https://www.yomizaka.com/en");
    for (const stay of [
      "/api/healthz",
      "/api/internal/sync",
      "/api/auth/callback",
      "/.well-known/assetlinks.json",
      "/healthz",
      "/robots.txt",
    ])
      expect(go(stay), stay).toBeNull();
    expect(go("/en/sign-in", "POST")).toBeNull();
    expect(go("/apix")).toBe("https://www.yomizaka.com/apix");
  });
});

describe("the commercial www is public, the code-name hosts leave search (epic krizaka/.github#119, 2026-11-05)", () => {
  const setup = () => {
    vi.stubEnv("APP_SEARCH_INDEXING", "on");
    vi.stubEnv("APP_PUBLIC_URL", "https://www.yomizaka.com");
    vi.stubEnv("APP_DEV_HOST", "dev.yomizaka.com");
  };

  it("the commercial www is not closed: no noindex, the sitemap is the app's", async () => {
    setup();
    vi.stubEnv("APP_PUBLIC_URL", "https://www.verikora.com");
    expect((await ask("https://www.verikora.com/en", "www.verikora.com")).headers.get("x-robots-tag")).toBeNull();
    expect((await ask("https://www.verikora.com/sitemap.xml", "www.verikora.com")).status).toBe(200);
  });

  it("www.yomizaka.com is closed: noindex, robots.txt Disallow, no sitemap", async () => {
    setup();
    expect((await ask("https://www.yomizaka.com/en", "www.yomizaka.com")).headers.get("x-robots-tag")).toBe(
      NOINDEX_HEADER,
    );
    expect((await ask("https://www.yomizaka.com/sitemap.xml", "www.yomizaka.com")).status).toBe(404);
    expect(await (await ask("https://www.yomizaka.com/robots.txt", "www.yomizaka.com")).text()).toBe(CLOSED_ROBOTS);
  });

  it("dev: a page answers 308 to the same path on www, noindex, even when the flag is on", async () => {
    setup();
    const res = await ask("https://dev.yomizaka.com/en/sign-in?next=%2Fapp", "dev.yomizaka.com");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://www.yomizaka.com/en/sign-in?next=%2Fapp");
    expect(res.headers.get("x-robots-tag")).toBe(NOINDEX_HEADER);
  });

  it("dev: robots.txt is Disallow: /; the API and .well-known keep serving, with noindex", async () => {
    setup();
    expect(await (await ask("https://dev.yomizaka.com/robots.txt", "dev.yomizaka.com")).text()).toBe(CLOSED_ROBOTS);
    for (const path of ["/api/healthz", "/api/verify", "/.well-known/assetlinks.json"]) {
      const res = await ask(`https://dev.yomizaka.com${path}`, "dev.yomizaka.com");
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-robots-tag"), path).toBe(NOINDEX_HEADER);
    }
  });

  it("the console host stays closed", async () => {
    setup();
    expect((await ask("https://admin.yomizaka.com/", "admin.yomizaka.com")).headers.get("x-robots-tag")).toBe(
      NOINDEX_HEADER,
    );
  });
});
