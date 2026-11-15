/** The options of a `pg` client from the environment: DATABASE_URL, and the cluster's CA (its escaped newlines restored) when the URL asks for TLS. */
export function pgClientOptions(env = process.env) {
  const url = new URL(env.DATABASE_URL ?? "");
  const tls = ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "");
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ...(tls ? { ssl: { ca: env.DATABASE_CA_CERT?.replaceAll(String.raw`\n`, "\n"), rejectUnauthorized: true } } : {}),
  };
}
