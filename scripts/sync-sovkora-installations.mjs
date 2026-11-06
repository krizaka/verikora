#!/usr/bin/env node
// Puts the Studio installations of Verikora's Sovkora account on the versions of scripts/sovkora-installations.json, through Sovkora's own
// API (GET /api/v1/studios/installations, POST /api/v1/studios/installations/{id}/upgrade) — never by hand in the database. Idempotent:
// an installation already on the wanted version (or newer) is left alone; a Studio not installed yet is installed (it pins the latest).
//
//   AI_API_URL=https://dev.sovkora.com/edge AI_API_TOKEN=… node scripts/sync-sovkora-installations.mjs [--check]
//
// `--check` changes nothing and exits 1 when an installation is behind. The token is read from the environment, never printed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Compares dotted versions (1.4.0 < 2.0.0). Pure. */
export function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const d = (left[i] ?? 0) - (right[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** What to do for each wanted Studio given what is installed: `install`, `upgrade` (with the id) or `keep`. Pure. */
export function plan(wanted, installed) {
  return Object.entries(wanted).map(([studioKey, version]) => {
    const found = installed.find((i) => i.studioKey === studioKey);
    if (!found) return { studioKey, version, action: "install" };
    if (compareVersions(found.pinnedVersion, version) >= 0)
      return { studioKey, version, action: "keep", pinnedVersion: found.pinnedVersion };
    return { studioKey, version, action: "upgrade", id: found.id, pinnedVersion: found.pinnedVersion };
  });
}

export async function syncInstallations({ base, token, wanted, check = false, fetchImpl = fetch, log = console.log }) {
  const call = async (path, method = "GET", body) => {
    const res = await fetchImpl(`${base.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Sovkora answered ${res.status} on ${method} ${path.split("?")[0]}`);
    return res.json();
  };
  const steps = plan(wanted, await call("/api/v1/studios/installations"));
  let behind = 0;
  for (const step of steps) {
    if (step.action === "keep") {
      log(`${step.studioKey}: on ${step.pinnedVersion} (wanted ${step.version}), left alone`);
      continue;
    }
    behind++;
    if (check) {
      const state = step.action === "install" ? "not installed" : `on ${step.pinnedVersion}`;
      log(`${step.studioKey}: ${state}, wanted ${step.version}`);
      continue;
    }
    const done =
      step.action === "install"
        ? await call(`/api/v1/studios/${step.studioKey}/installations?locale=en`, "POST", { config: {} })
        : await call(`/api/v1/studios/installations/${step.id}/upgrade`, "POST");
    if (compareVersions(done.pinnedVersion, step.version) < 0)
      throw new Error(`${step.studioKey} is on ${done.pinnedVersion} after the ${step.action}, wanted ${step.version}`);
    const result = step.action === "install" ? "installed" : `upgraded ${step.pinnedVersion} -> ${done.pinnedVersion}`;
    log(`${step.studioKey}: ${result}`);
  }
  return { behind, steps };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const token = process.env.AI_API_TOKEN;
  if (!token) throw new Error("AI_API_TOKEN is not set");
  const { studios } = JSON.parse(readFileSync(join(here, "sovkora-installations.json"), "utf8"));
  const check = process.argv.includes("--check");
  const { behind } = await syncInstallations({
    base: process.env.AI_API_URL ?? "https://dev.sovkora.com/edge",
    token,
    wanted: studios,
    check,
  });
  if (check && behind) process.exit(1);
}
