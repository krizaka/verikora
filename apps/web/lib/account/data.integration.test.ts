import { postgresAccounts } from "@krizaka/auth";
import { hashPassword, verifyPassword } from "@krizaka/auth";
import { beforeAll, describe, expect, it } from "vitest";

import { seedAudits } from "../audit-credits.testkit";
import { migrate, query } from "../db";
import { type StoragePolicy,storeDocument } from "../documents";
import { memoryStore } from "../storage/memory";
import { noneStore } from "../storage/none";
import { eraseAccount, exportData } from "./data";

/** Export and erasure against a real PostgreSQL (skipped without YOMIZAKA_DB_IT=1 and DATABASE_URL). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");

describe.runIf(enabled)("export and erasure (Loi 25)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const accounts = postgresAccounts({ query: async (sql, params) => query(sql, params) as never, mail: async () => undefined, baseUrl: "https://x", product: "Yomizaka", tokenPrefix: "ye", tokenHash: (t) => t, passwords: { hash: hashPassword, verify: verifyPassword } });
  const account = async (extra = "") => (await query<{ id: string }>(`INSERT INTO accounts (email, password_hash, email_verified_at, name ${extra ? ", " + extra.split("=")[0] : ""}) VALUES ($1, 'x', now(), 'Éric' ${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`, [`d-${Math.random().toString(36).slice(2)}@yomizaka.test`]))[0]!.id;
  const dev = () => memoryStore({ kind: "bunny", devOnly: true, owner: "krizaka", residency: "elsewhere" });
  const policy = (keep: boolean, store: ReturnType<typeof dev> | ReturnType<typeof noneStore>): StoragePolicy => ({ keep, store, now: NOW, purgeAfterHours: 24 });
  const file = { name: "bail.txt", type: "text/plain", size: 90 };
  const bytes = (n: string) => new TextEncoder().encode(`BAIL DE LOGEMENT\nLoyer mensuel : 1 450 $ ${n}\n`);

  it("exports the profile, the organisation, the documents with their kept files and their reports — never the password", async () => {
    const owner = await account();
    const store = dev();
    const kept = await storeDocument(owner, file, bytes("k"), "lease", policy(true, store));
    const gone = await storeDocument(owner, file, bytes("g"), "lease", policy(false, store));
    await query("INSERT INTO analyses (document_id, studio, status, run_id, report) VALUES ($1, 'compliance-check', 'succeeded', gen_random_uuid(), '{\"findings\":[]}')", [gone.summary.id]);
    await query("UPDATE documents SET content = ''::bytea, text = '' WHERE id = $1", [gone.summary.id]);
    const [lib] = await query<{ id: string }>("INSERT INTO libraries (owner_id, name) VALUES ($1, 'Ma bibliothèque') RETURNING id", [owner]);
    await query("INSERT INTO collections (library_id, name) VALUES ($1, 'Baux')", [lib!.id]);
    const out = await exportData(query, owner, () => store, NOW);
    expect(out.exportedAt).toBe(NOW.toISOString());
    expect(JSON.stringify(out)).not.toContain("password");
    expect(out.profile).toMatchObject({ name: "Éric" });
    // every account has a default collection (krizaka/yomizaka#205): the export says which one it is
    expect(out.libraries.flatMap((l) => l.collections).filter((c) => c.isDefault)).toHaveLength(1);
    expect(out.libraries.find((l) => l.name === "Ma bibliothèque")).toMatchObject({ collections: [{ name: "Baux", isDefault: false }] });
    const k = out.documents.find((d) => d.id === kept.summary.id)!;
    expect(Buffer.from(k.file!.base64, "base64").toString()).toContain("1 450");
    expect(k.storage).toBe("bunny");
    const g = out.documents.find((d) => d.id === gone.summary.id)!;
    expect(g.file).toBeNull();
    expect(g.text).toBeNull();
    expect(g.analyses).toHaveLength(1);
  });

  it("erases the account: kept files leave their store, the audit trail loses the person, the identity and its data go", async () => {
    const owner = await account();
    const store = dev();
    const doc = await storeDocument(owner, file, bytes("e"), "lease", policy(true, store));
    await query("INSERT INTO audit_log (actor_id, actor_label, action, target_id, detail, ip) VALUES ($1, 'eric@example.test', 'document.uploaded', $2, '{\"size\":1}', '203.0.113.9')", [owner, doc.summary.id]);
    expect(store.size()).toBe(1);
    await eraseAccount({ query, stores: () => store, accounts }, owner);
    expect(store.size()).toBe(0);
    expect(await query("SELECT 1 FROM accounts WHERE id = $1", [owner])).toHaveLength(0);
    expect(await query("SELECT 1 FROM documents WHERE owner_id = $1", [owner])).toHaveLength(0);
    // The package's table clears the actor with the account (ON DELETE SET NULL): the entry is found by its target, no longer by the person.
    const [trail] = await query<{ actor_label: string; ip: string | null; detail: unknown; actor_id: string | null }>("SELECT actor_label, ip, detail, actor_id FROM audit_log WHERE target_id = $1", [doc.summary.id]);
    expect(trail).toEqual({ actor_label: "deleted account", ip: null, detail: {}, actor_id: null });
  });

  it("an account that holds a credits ledger is erased like any other: the ledger keeps its lines under a bare id, nothing points at the person (yomizaka#261)", async () => {
    const owner = await account();
    const store = dev();
    await storeDocument(owner, file, bytes("g"), "lease", policy(true, store));
    await seedAudits(owner, { credits: 4, freeUsed: true });
    await eraseAccount({ query, stores: () => store, accounts }, owner);
    expect(store.size()).toBe(0);
    expect(await query("SELECT 1 FROM accounts WHERE id = $1", [owner])).toHaveLength(0);
    // the ledger is an accounting record: the lines are all there and the balance is as it was, but the id leads to no one
    const [ledger] = await query<{ n: number; total: number }>("SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::int AS total FROM credits.entry WHERE account_id = $1", [owner]);
    expect(ledger!.total).toBe(4);
    expect(ledger!.n).toBe(3); // the free grant, its spend, the purchase
    expect((await query<{ n: number }>('SELECT count(*)::int AS n FROM credits."grant" WHERE account_id = $1', [owner]))[0]!.n).toBe(2);
  });

  it("refuses while a subscription is active: cancel it in the portal first", async () => {
    const owner = await account("plan='PRO'");
    await query("UPDATE accounts SET subscription_status = 'active' WHERE id = $1", [owner]);
    await expect(eraseAccount({ query, stores: () => noneStore(), accounts }, owner)).rejects.toMatchObject({ status: 409, body: { code: "CANCEL_SUBSCRIPTION_FIRST" } });
    expect(await query("SELECT 1 FROM accounts WHERE id = $1", [owner])).toHaveLength(1);
  });
});
