import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StageNotice } from "./StageNotice";

describe("the development-version notice (verikora#364)", () => {
  it("shows in the stage dev, in both languages", () => {
    expect(renderToStaticMarkup(<StageNotice locale="fr" stage="dev" />)).toContain("Version de développement");
    expect(renderToStaticMarkup(<StageNotice locale="en" stage="dev" />)).toContain("Development version");
  });

  it("marks itself as top chrome, which the first-screen check counts above the page", () => {
    expect(renderToStaticMarkup(<StageNotice locale="en" stage="dev" />)).toContain("data-top-chrome");
  });

  it("renders nothing in production", () => {
    expect(renderToStaticMarkup(<StageNotice locale="fr" stage="prod" />)).toBe("");
  });

  it("shows when the stage is forgotten, so a deployment that does not say it is production is seen", () => {
    expect(renderToStaticMarkup(<StageNotice locale="en" stage="" />)).toContain("Development version");
  });

  it("is cleared by the site bar with CSS only: a zero-height sticky wrapper after it, no layout listener (verikora#449)", () => {
    const bar = readFileSync(new URL("./SiteChrome.tsx", import.meta.url), "utf8");
    expect(bar).toMatch(/className="[^"]*\bsticky\b[^"]*\btop-0\b[^"]*\bh-0\b[^"]*" data-site-bar/);
    expect(bar).toContain('className="relative top-3"');
    expect(bar).not.toMatch(/\bfixed\b|kz-top-chrome/);
    const notice = readFileSync(new URL("./StageNotice.tsx", import.meta.url), "utf8");
    expect(notice).not.toMatch(/use client|useEffect|addEventListener|ResizeObserver|TopChromeOffset/);
  });
});
