import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// The photo stack is proved inside the built image, not only on the CI machine (ADR-0010).
describe("the container smoke check", () => {
  it("is wired in CI and runs the photo check under the production memory limit", () => {
    expect(read(".github/workflows/ci.yml")).toContain("container-smoke: scripts/ci-container-smoke.sh");
    expect(read("scripts/ci-container-smoke.sh")).toContain("--memory=512m");
    expect(read("scripts/ci-container-smoke.sh")).toContain("/smoke/photos.cjs");
    for (const f of ["photos.cjs", "page.jpg", "page.heic"]) expect(existsSync(new URL(`../deploy/docker/smoke/${f}`, import.meta.url)), f).toBe(true);
  });
  it("the Dockerfile carries Tesseract's packages and its trained data into the image", () => {
    const dockerfile = read("deploy/docker/Dockerfile");
    for (const needle of ["tesseract\\.js-core", "@tesseract\\.js-data", "COPY --from=build --chown=yomizaka:yomizaka /ocr/"]) expect(dockerfile).toContain(needle);
  });
  it("holds the image to a size budget, and the runtime stays on musl (OpenDAL's linux-gnu binary needs glibc 2.38)", () => {
    const budget = Number(read("deploy/docker/image-size-budget-mb").trim());
    expect(Number.isInteger(budget) && budget > 0 && budget <= 320, "a positive budget within a few MB of what CI measured (304 MB with OpenDAL)").toBe(true);
    expect(read("scripts/ci-container-smoke.sh")).toContain("image-size-budget-mb");
    const dockerfile = read("deploy/docker/Dockerfile");
    expect(dockerfile.match(/^FROM node:22-alpine/gm)?.length, "the build stage is the musl node image").toBe(1);
    expect(dockerfile.match(/^FROM alpine:/gm)?.length, "the runtime stage is Alpine (musl) too").toBe(1);
    expect(dockerfile).not.toMatch(/^FROM node:[^ ]*(bookworm|bullseye|slim|jammy)/m);
  });
  it("the runtime stage is a slim Alpine plus the node binary, never the full node image (npm, yarn and the headers made 35 MB nobody runs)", () => {
    const dockerfile = read("deploy/docker/Dockerfile");
    const run = dockerfile.slice(dockerfile.indexOf(" AS run") - 120);
    expect(run).toMatch(/FROM alpine:[\d.]+@sha256:[0-9a-f]{64} AS run/);
    expect(run).toContain("COPY --from=build /usr/local/bin/node /usr/local/bin/node");
    expect(run).not.toMatch(/FROM node:/);
  });
  it("only what the OCR never loads is pruned: the browser builds of the core and the fast-model data, not the Node cores or the best_int data", () => {
    const dockerfile = read("deploy/docker/Dockerfile");
    expect(dockerfile).toContain("-name '*.wasm.js' -delete");
    expect(dockerfile).toContain("-type d -name 4.0.0 -exec rm -rf");
    expect(dockerfile).not.toMatch(/4\.0\.0_best_int[^\n]*(-delete|rm -rf)/);
  });
  it("OpenDAL's native binary is proved inside the image, and Next keeps the package external", () => {
    expect(read("scripts/ci-container-smoke.sh")).toContain("/smoke/opendal.cjs");
    expect(existsSync(new URL("../deploy/docker/smoke/opendal.cjs", import.meta.url))).toBe(true);
    expect(read("apps/web/next.config.mjs")).toMatch(/serverExternalPackages: \[[^\]]*"opendal"/);
  });
  it("the dockerignore keeps the smoke fixtures out of the build context only if they are not needed there", () => {
    expect(read(".dockerignore")).not.toMatch(/deploy/);
  });
});
