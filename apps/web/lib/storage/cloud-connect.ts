import { type CloudConnector, cloudConnector, type CloudConnectorName, type ConnectorApp, finishConnection, open, revokeConnection, seal, startConnection } from "@krizaka/storage";
import { addMinutes, isBefore } from "@krizaka/time";

import { refuse } from "../http";

/**
 * A person connects a cloud they already have (yomizaka#530, ADR-005 amendment): the OAuth exchange is `@krizaka/storage`'s (Arctic:
 * authorization code + PKCE S256), the files are OpenDAL's, behind the same registry as every provider. This module is the product's
 * side: which clouds this deployment offers, the state that carries the PKCE verifier (sealed, so no table), and the refusals.
 */

/** The names a person sees map onto the package's connectors. */
export const CLOUD = { dropbox: "dropbox", google: "google-drive", microsoft: "onedrive" } as const satisfies Record<string, CloudConnectorName>;
export const CLOUD_NAMES = Object.keys(CLOUD) as (keyof typeof CLOUD)[];
export type CloudName = keyof typeof CLOUD;

/** The registrations the deployment holds (read from the environment by the edge, passed in). */
export interface CloudRegistrations {
  MEDIA_CLOUD_DROPBOX_CLIENT_ID?: string;
  MEDIA_CLOUD_DROPBOX_CLIENT_SECRET?: string;
  MEDIA_CLOUD_GOOGLE_CLIENT_ID?: string;
  MEDIA_CLOUD_GOOGLE_CLIENT_SECRET?: string;
  MEDIA_CLOUD_MICROSOFT_CLIENT_ID?: string;
  MEDIA_CLOUD_MICROSOFT_CLIENT_SECRET?: string;
}

export const isCloudName = (value: string): value is CloudName => (CLOUD_NAMES as string[]).includes(value);

/** The address the provider sends the person back to: one for every cloud (the cloud is in the sealed state). */
export const callbackUrl = (publicUrl: string) => `${publicUrl.replace(/\/$/, "")}/api/me/storage/cloud/callback`;

/** The app registration for a cloud, or null when the deployment has none (then the cloud is not offered). */
export function registrationOf(name: CloudName, e: CloudRegistrations, publicUrl: string): ConnectorApp | null {
  const id = { dropbox: e.MEDIA_CLOUD_DROPBOX_CLIENT_ID, google: e.MEDIA_CLOUD_GOOGLE_CLIENT_ID, microsoft: e.MEDIA_CLOUD_MICROSOFT_CLIENT_ID }[name];
  const secret = { dropbox: e.MEDIA_CLOUD_DROPBOX_CLIENT_SECRET, google: e.MEDIA_CLOUD_GOOGLE_CLIENT_SECRET, microsoft: e.MEDIA_CLOUD_MICROSOFT_CLIENT_SECRET }[name];
  return id ? { clientId: id, clientSecret: secret || null, redirectUri: callbackUrl(publicUrl) } : null;
}

/** The clouds this deployment offers. */
export const offeredClouds = (e: CloudRegistrations, publicUrl: string): CloudName[] => CLOUD_NAMES.filter((n) => registrationOf(n, e, publicUrl) !== null);

// @fixed: a person who left for the provider's consent screen has a few minutes to come back; a longer-lived state is a replayable one
const STATE_MINUTES = 10;

interface StatePayload {
  owner: string;
  cloud: CloudName;
  verifier: string;
  nonce: string;
  until: string;
}

/** What the browser carries to the provider and back: the PKCE verifier, the person and the cloud, sealed under the vault key (AES-GCM: it cannot be read or changed). */
export function sealState(key: Uint8Array, payload: Omit<StatePayload, "until">, now: Date): string {
  return seal(JSON.stringify({ ...payload, until: addMinutes(now, STATE_MINUTES).toISOString() } satisfies StatePayload), key);
}

/** The state of a return, or a 400: not ours, changed, expired, or started by another person (so no one can finish a connection for someone else). */
export function openState(key: Uint8Array, state: string, owner: string, now: Date): StatePayload {
  let payload: StatePayload;
  try {
    payload = JSON.parse(open(state, key)) as StatePayload;
  } catch {
    throw refuse(400, "CLOUD_STATE_INVALID", "This connection link is not valid");
  }
  if (isBefore(new Date(payload.until), now)) throw refuse(400, "CLOUD_STATE_EXPIRED", "This connection link has expired: start again");
  if (payload.owner !== owner || !isCloudName(payload.cloud)) throw refuse(400, "CLOUD_STATE_INVALID", "This connection link is not valid");
  return payload;
}

export interface CloudFlow {
  /** Where the connectors point; tests aim them at a fake OAuth server. */
  connector: (name: CloudName) => CloudConnector;
  registration: (name: CloudName) => ConnectorApp | null;
  vaultKey: Uint8Array;
  now: () => Date;
  nonce: () => string;
}

export const connectorOf = (name: CloudName): CloudConnector => cloudConnector(CLOUD[name]);

/** Step 1: the address to send the person to. */
export function beginConnection(flow: CloudFlow, owner: string, name: CloudName): { url: string } {
  const app = flow.registration(name);
  if (!app) throw refuse(404, "CLOUD_NOT_OFFERED", "This cloud is not available on this deployment");
  const { url, verifier } = startConnection(flow.connector(name), app);
  // The provider's own `state` is replaced by ours: the verifier travels sealed inside it.
  const target = new URL(url);
  target.searchParams.set("state", sealState(flow.vaultKey, { owner, cloud: name, verifier, nonce: flow.nonce() }, flow.now()));
  return { url: target.toString() };
}

export interface Connected {
  cloud: CloudName;
  refreshToken: string;
  clientId: string;
  clientSecret: string | null;
}

/** Step 2: the code the provider sent back, exchanged for the grant (the refresh token is what is kept, sealed by the registry). */
export async function completeConnection(flow: CloudFlow, owner: string, input: { code: string; state: string }): Promise<Connected> {
  const payload = openState(flow.vaultKey, input.state, owner, flow.now());
  const app = flow.registration(payload.cloud);
  if (!app) throw refuse(404, "CLOUD_NOT_OFFERED", "This cloud is not available on this deployment");
  const tokens = await finishConnection(flow.connector(payload.cloud), app, { code: input.code, verifier: payload.verifier });
  return { cloud: payload.cloud, refreshToken: tokens.refreshToken!, clientId: app.clientId, clientSecret: app.clientSecret };
}

/** The person's disconnect, provider side: the grant is revoked where the cloud allows it. A refusal there never keeps the person connected: the caller forgets the token either way. */
export async function revokeGrant(flow: CloudFlow, name: CloudName, refreshToken: string): Promise<boolean> {
  const app = flow.registration(name);
  if (!app) return false;
  try {
    await revokeConnection(flow.connector(name), app, refreshToken);
    return true;
  } catch {
    return false;
  }
}
