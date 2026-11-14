import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { productionProblems, readEnv } from "./env";

// Every CI script that starts the built app in production (`next start`, NODE_ENV=production) gives it every key the boot
// requires (`productionProblems`), from its own exports or from the env of every workflow that runs it. A key made required
// in env.ts and forgotten in one start script killed `mobile-e2e` at boot (verikora#818, MEDIA_DOCUMENTS_TENANT): this test
// names the script instead of a red emulator job.
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const requiredKeys = productionProblems(readEnv({ NODE_ENV: "production" }))
  .map((problem) => /^[A-Z][A-Z0-9_]+/.exec(problem)?.[0])
  .filter((key): key is string => Boolean(key));

const startScripts = readdirSync(new URL("scripts/", root))
  .filter((name) => name.endsWith(".sh"))
  .filter((name) => {
    const sh = read(`scripts/${name}`);
    return sh.includes("next start") && sh.includes("NODE_ENV=production");
  });

const workflows = readdirSync(new URL(".github/workflows/", root))
  .filter((name) => name.endsWith(".yml"))
  .map((name) => ({ name, text: read(`.github/workflows/${name}`) }));

const exported = (sh: string) => [...sh.matchAll(/^\s*export ([A-Z][A-Z0-9_]*)/gm)].map((m) => m[1]);
const declared = (yml: string) => [...yml.matchAll(/^\s+([A-Z][A-Z0-9_]*)(?:=|: )/gm)].map((m) => m[1]);

describe("the CI scripts that start Verikora in production", () => {
  it("the boot's required keys are read from env.ts, and the start scripts are found", () => {
    expect(requiredKeys).toEqual(
      expect.arrayContaining(["DATABASE_URL", "AUTH_SESSION_SECRET", "MEDIA_DOCUMENTS_TENANT"]),
    );
    expect(startScripts).toEqual(
      expect.arrayContaining(["ci-after-build.sh", "ci-mobile-backend.sh", "ci-visual-start.sh"]),
    );
  });

  it.each(startScripts)(
    "%s gives the app every key its boot requires, through every workflow that runs it",
    (script) => {
      const own = exported(read(`scripts/${script}`));
      const callers = workflows.filter((w) => w.text.includes(`scripts/${script}`));
      expect(callers.length, `${script} is run by no workflow`).toBeGreaterThan(0);
      for (const caller of callers) {
        const given = new Set([...own, ...declared(caller.text)]);
        expect(
          requiredKeys.filter((key) => !given.has(key)),
          `${caller.name} runs ${script} without these keys`,
        ).toEqual([]);
      }
    },
  );
});
