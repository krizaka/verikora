import { randomUUID } from "node:crypto";

import { cloudConnector } from "@krizaka/storage";

import { env } from "@/lib/env";
import { assertUserConnectors } from "@/lib/settings/guards";
import { CLOUD, type CloudFlow, offeredClouds, registrationOf } from "@/lib/storage/cloud-connect";
import { vaultFrom } from "@/lib/storage/providers";

import { systemClock } from "./system-clock";

/** What the OAuth flow of a connected cloud runs on (the app registrations from the environment, the vault key that seals the state), or null when no vault key is deployed. */
export function cloudFlow(): CloudFlow | null {
  const e = env();
  const vault = vaultFrom(e);
  if (!vault) return null;
  return {
    connector: (name) => cloudConnector(CLOUD[name]),
    registration: (name) => registrationOf(name, e, e.APP_PUBLIC_URL),
    vaultKey: vault.key,
    now: () => systemClock.now(),
    nonce: randomUUID,
  };
}

/** The clouds a person may connect right now: the deployment holds their registration and the administrator opened user connections. */
export async function cloudsOffered(): Promise<string[]> {
  const e = env();
  if (!vaultFrom(e)) return [];
  try {
    await assertUserConnectors();
  } catch {
    return [];
  }
  return offeredClouds(e, e.APP_PUBLIC_URL);
}
