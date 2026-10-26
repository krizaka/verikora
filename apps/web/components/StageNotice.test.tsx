import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StageNotice } from "./StageNotice";

describe("the development-version notice (yomizaka#364)", () => {
  it("shows in the stage dev, in both languages", () => {
    expect(renderToStaticMarkup(<StageNotice locale="fr" stage="dev" />)).toContain("Version de développement");
    expect(renderToStaticMarkup(<StageNotice locale="en" stage="dev" />)).toContain("Development version");
  });

  it("renders nothing in production", () => {
    expect(renderToStaticMarkup(<StageNotice locale="fr" stage="prod" />)).toBe("");
  });

  it("shows when the stage is forgotten, so a deployment that does not say it is production is seen", () => {
    expect(renderToStaticMarkup(<StageNotice locale="en" stage="" />)).toContain("Development version");
  });
});
