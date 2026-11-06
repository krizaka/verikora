import crypto from "node:crypto";

/**
 * The key that signs audit reports: Ed25519, the private half in `APP_REPORT_SIGNING_KEY` (lib/report-signer.ts reads it) (base64 of the PKCS#8 DER — a
 * DO SECRET, never printed, never in the repository), the public half derived from it and shown on /app/verifications/report so anyone
 * can check a report without us. Development without a key uses a fixed, public development key: its reports say
 * `development` in their key id and are worth nothing.
 */
export interface SigningKey {
  /** `dev:` or `ed25519:` + the first 16 hex of the SHA-256 of the public key (SPKI DER). */
  keyId: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
}

/** The development key's seed: public on purpose (this repository), so nothing signed with it proves anything. */
const DEV_SEED = Buffer.from("verikora-development-report-key!!", "utf8"); // 32 bytes
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
export const DEVELOPMENT_KEY_BASE64 = Buffer.concat([PKCS8_ED25519_PREFIX, DEV_SEED]).toString("base64");

export const keyIdOf = (publicKey: crypto.KeyObject, development = false) =>
  `${development ? "dev" : "ed25519"}:${crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 16)}`;

/** A key from the base64 PKCS#8 DER the secret holds. Throws (without the value) when it is not an Ed25519 private key. */
export function parseSigningKey(base64: string, development = false): SigningKey {
  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey({ key: Buffer.from(base64.trim(), "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new Error("APP_REPORT_SIGNING_KEY is not a base64 PKCS#8 private key");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("APP_REPORT_SIGNING_KEY must be an Ed25519 key");
  const publicKey = crypto.createPublicKey(privateKey);
  return { keyId: keyIdOf(publicKey, development), privateKey, publicKey };
}

/** A new key, for the maintainer to store as a secret (scripts/generate-report-key.mjs) and for tests. */
export function generateSigningKeyBase64(): string {
  return crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
}

/** The public key as the verify page shows it: base64 of the SPKI DER. */
export const publicKeyBase64 = (key: SigningKey) =>
  key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
