import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { EnvironmentBand } from "./EnvironmentBand";

// yomizaka#364: the stage drives the « development version » notice; production shows nothing.
describe("the development-version notice (yomizaka#364)", () => {
  it("stage dev renders the notice, in French first and in English when chosen", () => {
    expect(renderToStaticMarkup(<EnvironmentBand locale="fr" stage="dev" />)).toContain(fr.environment.title);
    expect(renderToStaticMarkup(<EnvironmentBand locale="en" stage="dev" />)).toContain(en.environment.message);
  });
  it("stage prod renders nothing", () => {
    expect(renderToStaticMarkup(<EnvironmentBand locale="fr" stage="prod" />)).toBe("");
    expect(renderToStaticMarkup(<EnvironmentBand locale="en" stage="production" />)).toBe("");
  });
});

describe("the deployment specs set the stage (yomizaka#364)", () => {
  const dir = join(__dirname, "../../../deploy/digitalocean");
  const specs = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  const stageOf = (file: string) => /key:\s*APP_ENVIRONMENT[^}]*value:\s*"([^"]*)"/.exec(readFileSync(join(dir, file), "utf8"))?.[1];
  it("the dev spec says dev", () => {
    expect(specs).toContain("dev.app.yaml");
    expect(stageOf("dev.app.yaml")).toBe("dev");
  });
  it("no production spec says dev, and every other spec says its stage", () => {
    for (const file of specs.filter((f) => /prod/.test(f))) expect(stageOf(file)).toBe("prod");
  });
});
