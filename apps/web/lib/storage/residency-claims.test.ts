import { readFileSync } from "node:fs";

import { countryOf } from "@krizaka/storage";
import { STORAGE_KIND } from "@verikora/core";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { storedAs } from "./where";

/**
 * A public message may say « Canada » only when the configured storage region of what it describes is Canadian.
 * The regions come from the deployed spec (deploy/digitalocean/dev.app.yaml), the map from `COUNTRY_OF_REGION` of @krizaka/storage.
 */

const SPEC = new URL("../../../../deploy/digitalocean/dev.app.yaml", import.meta.url);

type Store = "database" | "documents" | "configured";
interface Environment {
  name: string;
  /** The region of the managed database. */
  database: string;
  /** The region of the kept-documents store, or null when nothing is kept. */
  documents: string | null;
}

/** Reads the environment a spec deploys: its App Platform region, its database (the same region) and its documents store. */
function environmentOf(name: string, spec: string): Environment {
  const region = /^region:\s*(\S+)/m.exec(spec)?.[1];
  if (!region) {
    throw new Error(`${name}: the spec names no region`);
  }
  const env = (key: string) => new RegExp(`key: ${key},[^}]*value: "([^"]*)"`).exec(spec)?.[1];
  const provider = env("MEDIA_DOCUMENTS_PROVIDER") ?? STORAGE_KIND.none;
  let documents: string | null = null;
  if (provider === STORAGE_KIND.bunny) {
    documents = (env("MEDIA_STORAGE_ENDPOINT") ?? "").split(".")[0] || null;
  }
  if (provider === STORAGE_KIND.s3) {
    documents = env("MEDIA_S3_REGION") ?? null;
  }
  return { name, database: region, documents };
}

/** Whether a claim holds in an environment: its region must map to Canada. An unmapped region never holds. */
function claimHolds(store: Store, env: Environment): boolean {
  if (store === "configured") {
    return true;
  } // generated from the configured region by code (where.test.ts)
  const region = store === "database" ? env.database : env.documents;
  if (region === null) {
    return true;
  } // nothing is kept, so no store to name
  return countryOf(region) === "CA";
}

/** Every public message that says « Canada » or « Toronto », by its path, and the store it describes. */
const CLAIMS: Record<string, Store> = {
  "docs.data.intro": "database",
  "landing.what.trust": "database",
  "privacy.sections.2.p": "database",
  "privacy.sections.3.p": "database",
  "console.document.where.krizakaCanadaEncrypted": "database",
  "console.document.where.krizakaCanada": "configured",
  "console.settings.storage.whereCanada": "configured",
  "console.errors.STORAGE_NOT_IN_CANADA": "configured", // the refusal is generated from the tested region of the provider (assertDefaultResidency)
  "console.settings.storage.whereElsewhere": "configured", // « outside Canada »: generated from the configured region
};

/** Mentions of Canada that are not about where data lives. */
const NOT_RESIDENCY: Record<string, string> = {
  "terms.sections.2.p": "prices are in Canadian dollars: a currency, not a storage claim",
};

function leaves(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") {
    return [[path.join("."), node]];
  }
  if (Array.isArray(node)) {
    return node.flatMap((v, i) => leaves(v, [...path, String(i)]));
  }
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]));
  }
  return [];
}

const CLAIM = /\bCanad|Toronto/i;
const claimPaths = (dict: unknown) =>
  leaves(dict)
    .filter(([path, text]) => CLAIM.test(text) && !(path in NOT_RESIDENCY))
    .map(([path]) => path);

const spec = readFileSync(SPEC, "utf8");
const DEV = environmentOf("dev", spec);
const ENVIRONMENTS = [DEV];

describe("public claims about Canada follow the configured regions", () => {
  it("reads the deployed environment: the database in Toronto, the kept documents in New York", () => {
    expect(DEV).toEqual({ name: "dev", database: "tor", documents: "ny" });
  });

  it("maps every configured region to a country (an unknown region is refused, never guessed)", () => {
    for (const env of ENVIRONMENTS) {
      expect(countryOf(env.database), `${env.name} database region`).toBeDefined();
      if (env.documents) {
        expect(countryOf(env.documents), `${env.name} documents region`).toBeDefined();
      }
    }
  });

  it("names every Canada or Toronto claim in en and fr, and nothing stale", () => {
    const found = [...new Set([...claimPaths(en), ...claimPaths(fr)])].sort();
    expect(found).toEqual(Object.keys(CLAIMS).sort());
  });

  it("holds every database claim in every environment: the database region is Canadian", () => {
    for (const path of Object.keys(CLAIMS).filter((p) => CLAIMS[p] === "database")) {
      for (const env of ENVIRONMENTS) {
        expect(claimHolds("database", env), `${path} in ${env.name}`).toBe(true);
      }
    }
  });

  it("makes no documents claim: the deployed documents store is New York, so « kept in Canada » would be false", () => {
    expect(Object.values(CLAIMS)).not.toContain("documents");
    expect(claimHolds("documents", DEV)).toBe(false);
  });

  it("is consistent with the code: the database descriptor the console shows is in Canada", () => {
    const active = storedAs(STORAGE_KIND.none, {
      kind: "none",
      endpoint: null,
      region: null,
      residency: "unknown",
      encrypted: false,
      owner: "krizaka",
      devOnly: false,
    });
    expect(countryOf(storedAs(STORAGE_KIND.database, active).region ?? "")).toBe("CA");
  });

  it("refuses a Canada claim about documents stored outside Canada (the rule itself)", () => {
    const newYork: Environment = { name: "fixture", database: "tor", documents: "ny" };
    expect(claimHolds("documents", newYork)).toBe(false);
    expect(claimHolds("database", { name: "fixture", database: "ny", documents: null })).toBe(false);
    expect(claimHolds("documents", { name: "fixture", database: "tor", documents: null })).toBe(true);
  });
});
