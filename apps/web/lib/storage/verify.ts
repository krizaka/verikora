import { checkEndpointDns, type ObjectStore, type OpenContext, openProvider, residencyOfConfig, type Resolver, StorageError, testConnection, type TestStep } from "@krizaka/storage";

export interface S3Candidate {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Verification {
  ok: boolean;
  steps: TestStep[];
  /** The address as it will be used (an origin), the host shown to the person, the region and where that region is. */
  origin: string | null;
  host: string | null;
  region: string;
  residency: "canada" | "elsewhere";
  error: "ENDPOINT_INVALID" | "ENDPOINT_NOT_ALLOWED" | null;
}

/** Canada only when the region and the endpoint agree (the shared table); an endpoint that cannot be read claims nothing. */
function residencyOfEndpoint(endpoint: string, region: string) {
  try {
    return residencyOfConfig({ provider: "s3", endpoint, region });
  } catch {
    return "elsewhere" as const;
  }
}

/**
 * Verifies a person's own S3 before it is saved (ADR-005: the same checks as the registry's `test`, which run again when the provider
 * is registered): the endpoint must be a public https address (`checkEndpointDns` of the package, never Krizaka's own network), then
 * a probe object is written, read back and deleted (`testConnection`). Says what it found, including where the data would live.
 * The registry opens https endpoints only (a local http S3 server is not one of its kinds: development uses the `folder` kind). `store` replaces the opened one in tests.
 */
export async function verifyS3(
  candidate: S3Candidate,
  deps: { ctx: OpenContext; resolve?: Resolver; probeId: string; store?: ObjectStore },
): Promise<Verification> {
  const base = { steps: [] as TestStep[], region: candidate.region, residency: residencyOfEndpoint(candidate.endpoint, candidate.region), origin: null, host: null };
  try {
    new URL(candidate.endpoint.trim());
  } catch {
    return { ...base, ok: false, error: "ENDPOINT_INVALID" };
  }
  let origin: string;
  try {
    origin = await checkEndpointDns(candidate.endpoint.trim(), deps.resolve ? { resolve: deps.resolve } : {});
  } catch (error) {
    if (error instanceof StorageError) return { ...base, ok: false, error: "ENDPOINT_NOT_ALLOWED" };
    throw error;
  }
  const opened = await openProvider("s3", { endpoint: origin, region: candidate.region, bucket: candidate.bucket }, { accessKeyId: candidate.accessKeyId, secretAccessKey: candidate.secretAccessKey }, deps.ctx);
  const out = await testConnection(deps.store ?? opened.store, deps.probeId, () => deps.ctx.clock.now().getTime());
  return { ok: out.ok, steps: out.steps, origin, host: new URL(origin).host, region: candidate.region, residency: residencyOfEndpoint(origin, candidate.region), error: null };
}
