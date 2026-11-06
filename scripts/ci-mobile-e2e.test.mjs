import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const FLOWS = "apps/mobile/.maestro";
const flows = readdirSync(new URL(`../${FLOWS}`, import.meta.url)).filter((f) => f.endsWith(".yaml"));

// The phone's Maestro flows run in CI on every pull request (krizaka/.github#241) as the seeded persona Éric (krizaka/verikora#346).
describe("the phone's Maestro flows in CI", () => {
  it("every flow runs in CI unless it is tagged `manual` (a flow is fixed or tagged, never deleted)", () => {
    expect(flows).toEqual(expect.arrayContaining(["smoke.yaml", "tabs.yaml", "check-document.yaml"]));
    for (const f of flows) {
      expect(read(`${FLOWS}/${f}`), f).toMatch(/^tags:\n {2}- (ci|manual)\n/m);
    }
  });

  it("the flows take the persona's login from the environment, never a literal value", () => {
    for (const f of [...flows.map((name) => name), "shared/sign-in.yaml"]) {
      const flow = read(`${FLOWS}/${f}`);
      expect(flow, f).not.toMatch(/inputText: (?!\$\{PERSONA_(EMAIL|PASSWORD)\})\S/);
      expect(flow, f).not.toMatch(/@[a-z0-9-]+\.(com|ca|test)\b/i);
    }
    expect(read(`${FLOWS}/shared/sign-in.yaml`)).toContain("${PERSONA_PASSWORD}");
  });

  it("mobile-ci.yml calls the reusable workflow as the `mobile-e2e` job, on pull requests, pinned, never skipped or tolerated", () => {
    const ci = read(".github/workflows/mobile-ci.yml");
    expect(ci).toMatch(/\n {2}mobile-e2e:\n/);
    expect(ci).toMatch(/uses: krizaka\/\.github\/\.github\/workflows\/mobile-e2e\.yml@[0-9a-f]{40}/);
    expect(ci).toMatch(/\n {2}pull_request:\n(?! {4}paths)/); // no path filter: a required check must always report
    expect(ci).not.toMatch(/continue-on-error|if: false|\n {4}if:/);
    expect(ci).toContain("setup-command: bash scripts/ci-mobile-backend.sh");
  });

  it("the CI backend is dev only, throwaway, and seeds the persona with the run's own login", () => {
    const sh = read("scripts/ci-mobile-backend.sh");
    expect(sh).toContain("export APP_ENVIRONMENT=dev");
    expect(sh).not.toMatch(/APP_ENVIRONMENT=prod/);
    expect(sh).toContain("DEMO_ACCOUNT_PASSWORD:?");
    expect(sh).toContain('demo-seed/cli.mjs --cast --reset --locale "$LOCALE" --check');
  });

  it("the seed refuses a non-dev environment before it touches any database (the persona is never usable in production)", () => {
    for (const environment of ["prod", "production", "staging"]) {
      let message = "";
      try {
        execFileSync("node", ["scripts/demo-seed/cli.mjs", "--persona", "eric"], {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          env: {
            PATH: process.env.PATH,
            APP_ENVIRONMENT: environment,
            DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none",
          },
          stdio: "pipe",
        });
      } catch (error) {
        message = String(error.stderr);
      }
      expect(message, environment).toMatch(/demo:seed: .*refused/);
    }
  });
});
