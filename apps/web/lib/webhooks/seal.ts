import crypto from "node:crypto";

/**
 * Keeps an endpoint's signing secret at rest (verikora#241): AES-256-GCM under a key derived from a server secret, so a leaked
 * table opens no endpoint's secret. `v1.<iv>.<tag>.<ciphertext>`, base64url. The secret is given, never read here.
 */
export function sealer(serverSecret: string): { seal: (plain: string) => string; open: (sealed: string) => string } {
  const key = Buffer.from(crypto.hkdfSync("sha256", serverSecret, "verikora", "webhook-endpoint-secret", 32));
  return {
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        data.toString("base64url"),
      ].join(".");
    },
    open(sealed) {
      const [version, iv, tag, data] = sealed.split(".");
      if (version !== "v1" || !iv || !tag || !data) throw new Error("not a sealed secret");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
