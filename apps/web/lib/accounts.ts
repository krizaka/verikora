import { decoyHash, verifyPassword } from "@krizaka/auth";
import type { AdminUser } from "@verikora/core";

import { audit } from "./audit";
import { query } from "./db";
import { refuse } from "./http";

/**
 * Accounts are provisioned by an operator (scripts/qa-accounts.mjs): nobody signs up while AUTH_SIGNUP_ENABLED is not
 * `true`. A wrong address and a wrong password get the same 401 after the same work; a suspended account is refused
 * only once its password is right, so the refusal tells strangers nothing.
 */
export async function checkPassword(
  email: string,
  password: string,
  headers: Headers,
): Promise<{ id: string; email: string; locale: "en" | "fr" }> {
  const address = email.trim().toLowerCase();
  const [row] = await query<{
    id: string;
    email: string;
    status: string;
    email_verified_at: Date | null;
    locale: "en" | "fr";
    password_hash: string | null;
  }>("SELECT id, email, status, email_verified_at, locale, password_hash FROM accounts WHERE email = $1", [address]);
  const right = await verifyPassword(password, row?.password_hash ?? (await decoyHash()));
  if (!row?.password_hash || !right) {
    if (row)
      await audit({
        action: "auth.sign_in_refused",
        actorId: row.id,
        actorLabel: row.email,
        targetId: row.id,
        detail: { reason: "wrong_password" },
        headers,
      });
    throw refuse(401, "INVALID_CREDENTIALS", "Wrong e-mail or password");
  }
  if (row.status !== "ACTIVE") {
    await audit({
      action: "auth.sign_in_refused",
      actorId: row.id,
      actorLabel: row.email,
      targetId: row.id,
      detail: { reason: "suspended" },
      headers,
    });
    throw refuse(403, "SUSPENDED", "Account suspended");
  }
  if (!row.email_verified_at) throw refuse(403, "EMAIL_NOT_VERIFIED", "Confirm your e-mail address first");
  await query("UPDATE accounts SET last_seen_at = now() WHERE id = $1", [row.id]);
  await audit({ action: "auth.sign_in", actorId: row.id, actorLabel: row.email, targetId: row.id, headers });
  return { id: row.id, email: row.email, locale: row.locale };
}

export async function listUsers(): Promise<AdminUser[]> {
  const rows = await query<{
    id: string;
    email: string;
    role: "USER" | "ADMIN";
    status: "ACTIVE" | "SUSPENDED";
    documents: string;
    created_at: Date;
    last_seen_at: Date | null;
  }>(
    `SELECT a.id, a.email, a.role, a.status, a.created_at, a.last_seen_at, (SELECT count(*) FROM documents d WHERE d.owner_id = a.id) AS documents
       FROM accounts a ORDER BY a.created_at DESC LIMIT 500`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    documents: Number(r.documents),
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
  }));
}
