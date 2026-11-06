// The demo cast of Verikora, read from `@krizaka/org` (krizaka/.github#356): who is seeded, with which name, role and language.
// E-mail addresses and passwords are NOT in the cast: they come from the environment (the deployment's own configuration), with
// documented defaults that exist only for a local database.
import { castOf, persona, personaByRole, seedFingerprint } from "@krizaka/org";

/** The product's id in `@krizaka/org`. */
export const BRAND_ID = "verikora";
export const CAST = castOf(BRAND_ID);
export const CAST_MEMBER = personaByRole(BRAND_ID, "member");
export const CAST_ADMIN = personaByRole(BRAND_ID, "admin");
export const CAST_CAMILLE = persona(BRAND_ID, "camille");
export { seedFingerprint };

/** The password a LOCAL database gets when none is given. Never used on a host that is not this machine. */
export const LOCAL_PASSWORD = "local-cast-password-0123";

const isLocalHost = (databaseUrl) => {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"].includes(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
};

/**
 * The accounts of the cast for an environment: Éric (the member), Mira (the administrator) and Camille, with the display name of their persona.
 * The same variables as `qa-accounts` (`QA_*`) and the demo seed (`APP_DEMO_*`): one list, so a deployment and a laptop hold the same people.
 */
export function castAccounts(env) {
  const local = isLocalHost(env.DATABASE_URL ?? "");
  const pick = (role, persona, emailKeys, passwordKeys) => {
    const email = emailKeys.map((k) => env[k]).find(Boolean) ?? `${persona.id}@demo.verikora.test`;
    const password = passwordKeys.map((k) => env[k]).find(Boolean) ?? (local ? LOCAL_PASSWORD : undefined);
    if (!password || password.length < 12)
      throw new Error(`the ${role} password is missing or shorter than 12 characters (${passwordKeys.join(" or ")})`);
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error(`the ${role} e-mail is invalid (${emailKeys.join(" or ")})`);
    return { persona, role, email: email.trim().toLowerCase(), password };
  };
  return [
    pick(
      "USER",
      CAST_MEMBER,
      ["APP_DEMO_ACCOUNT_EMAIL", "QA_USER_EMAIL"],
      ["APP_DEMO_ACCOUNT_PASSWORD", "QA_USER_PASSWORD"],
    ),
    pick(
      "ADMIN",
      CAST_ADMIN,
      ["APP_DEMO_ADMIN_EMAIL", "QA_ADMIN_EMAIL"],
      ["APP_DEMO_ADMIN_PASSWORD", "QA_ADMIN_PASSWORD"],
    ),
    pick("USER", CAST_CAMILLE, ["QA_CAMILLE_EMAIL"], ["QA_CAMILLE_PASSWORD"]),
  ];
}

/** The tables the fingerprint counts, for the accounts of the cast only (a dev database may hold other people's rows too). */
export const FINGERPRINT_QUERIES = {
  accounts: "SELECT count(*)::int AS n FROM accounts WHERE id = ANY($1)",
  collections: "SELECT count(*)::int AS n FROM collections WHERE owner_id = ANY($1)",
  documents: "SELECT count(*)::int AS n FROM documents WHERE owner_id = ANY($1)",
  analyses:
    "SELECT count(*)::int AS n FROM analyses WHERE document_id IN (SELECT id FROM documents WHERE owner_id = ANY($1))",
  screenings: "SELECT count(*)::int AS n FROM screenings WHERE landlord_id = ANY($1)",
  file_report_shares: "SELECT count(*)::int AS n FROM file_report_shares WHERE landlord_id = ANY($1)",
};

/** Counts per table for the given account ids, and the string `seedFingerprint` builds from them. */
export async function fingerprintOf(q, ownerIds) {
  const counts = {};
  for (const [table, sql] of Object.entries(FINGERPRINT_QUERIES)) counts[table] = (await q(sql, [ownerIds]))[0].n;
  return { counts, fingerprint: seedFingerprint(counts) };
}

/**
 * Whether a database holds the recorded cast. A local or CI database is the seed's alone: the fingerprint is exact. The shared dev
 * database is lived in (analyses and documents made in the app, other tests), so there the check is « everything recorded is
 * there »: the accounts exactly, every other count at least.
 */
export function matchesRecorded(fingerprint, expected, exact) {
  const counts = (text) =>
    Object.fromEntries(
      text
        .split(";")
        .map((pair) => pair.split("="))
        .map(([k, v]) => [k, Number(v)]),
    );
  const got = counts(fingerprint);
  return Object.entries(counts(expected)).every(([table, n]) =>
    exact || table === "accounts" ? got[table] === n : got[table] >= n,
  );
}
