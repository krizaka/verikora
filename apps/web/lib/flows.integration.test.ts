import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import {
  availableFlows,
  createFlow,
  grantConsent,
  listAdminFlows,
  publish,
  resolveStart,
  revokeConsent,
  saveDraft,
  seedDatabase,
  setEnvironment,
} from "./flows";
import { SEED_FLOWS } from "./flows-seed";
import { buildPayload, issueReport, sha256, verifyReport } from "./report";
import { reportLabels } from "./report-labels";
import { signingKey } from "./report-signer";

// Two starts seeding at once (two instances, or the tests of several files) must not collide on the same key (the CI flake, #268).
describe.runIf(process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL)("seeding the flows", () => {
  it("is safe to run many times at once", async () => {
    await migrate();
    const runs = await Promise.allSettled(Array.from({ length: 8 }, () => seedDatabase()));
    expect(runs.filter((r) => r.status === "rejected")).toEqual([]);
  });
});

/** ADR-0003 against a real PostgreSQL (CI's service; locally `DATABASE_IT=1 DATABASE_URL=… pnpm test`). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("flows in the database", () => {
  const stamp = Date.now();
  let admin: { id: string; email: string };
  let landlord: { id: string; email: string };

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    [admin] = (await query<{ id: string; email: string }>(
      "INSERT INTO accounts (email, role) VALUES ($1, 'ADMIN') RETURNING id, email",
      [`flows-admin-${stamp}@verikora.test`],
    )) as [typeof admin];
    [landlord] = (await query<{ id: string; email: string }>(
      "INSERT INTO accounts (email) VALUES ($1) RETURNING id, email",
      [`flows-landlord-${stamp}@verikora.test`],
    )) as [typeof landlord];
  });

  const flowId = async (key: string) => (await listAdminFlows()).find((f) => f.key === key)!.id;

  it("seeds the existing flows once, enabled where they were, and a re-run changes nothing", async () => {
    expect(await seedDatabase()).toEqual([]);
    const dev = (await availableFlows("dev", { fallback: false })).map((f) => f.key);
    for (const s of SEED_FLOWS.filter((x) => x.environments.includes("dev"))) expect(dev).toContain(s.key);
    const prod = (await availableFlows("prod", { fallback: false })).map((f) => f.key);
    expect(prod).toEqual(expect.arrayContaining(["lease-check-landlord", "lease-check-tenant"]));
    expect(prod).not.toContain("file-check-freelancer");
  });

  it("hides a disabled flow, and shows it again when it is enabled", async () => {
    const id = await flowId("file-check-business");
    await setEnvironment(admin, id, "dev", false);
    expect((await availableFlows("dev", { fallback: false })).map((f) => f.key)).not.toContain("file-check-business");
    await setEnvironment(admin, id, "dev", true);
    expect((await availableFlows("dev", { fallback: false })).map((f) => f.key)).toContain("file-check-business");
  });

  it("versions without touching the past: a published version is immutable, an old analysis keeps its version, an old report still verifies", async () => {
    const key = `lease-v-${stamp}`;
    const definition = { ...SEED_FLOWS[0]!.definition };
    const { id } = await createFlow(admin, key, definition);
    const [v1] = await query<{ id: string }>("SELECT id FROM flow_versions WHERE flow_id = $1 AND version = 1", [id]);
    await publish(admin, id, v1!.id);
    await setEnvironment(admin, id, "dev", true);

    // An analysis (and its signed report) made under v1.
    const [owner] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [
      `flows-owner-${stamp}@verikora.test`,
    ]);
    const sha = sha256(`lease ${stamp}`);
    const [d] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content) VALUES ($1, 'Bail', 'bail.txt', 'text/plain', 4, $2, 'bail') RETURNING id",
      [owner!.id, sha],
    );
    const [a] = await query<{ id: string }>(
      "INSERT INTO analyses (document_id, studio, status, run_id, report, finished_at, flow_version_id) VALUES ($1, 'compliance-check', 'succeeded', $2, '{}', now(), $3) RETURNING id",
      [d!.id, `run-flow-${stamp}`, v1!.id],
    );
    const issued = issueReport(
      buildPayload(
        { sha256: sha, filename: "bail.txt", title: "Bail", sizeBytes: 4, pages: null },
        {
          id: a!.id,
          studio: "compliance-check",
          status: "succeeded",
          runId: `run-flow-${stamp}`,
          blueprintVersion: "1.2.0",
          inputs: {},
          report: {
            rulesetId: "qc-residential-lease",
            rulesetVersion: "2024-02-21",
            rulesetRevision: 1,
            jurisdiction: "QC",
            asOf: "2026-10-17",
            findings: [{ ruleId: "R", severity: "BLOCKING", verdict: "FAIL", explanation: "x" }],
          },
          error: null,
          createdAt: "2026-10-17T10:00:00.000Z",
          finishedAt: "2026-10-17T10:00:01.000Z",
        },
        "fr",
      ),
      reportLabels("fr"),
      signingKey(),
    );

    // Edit → a draft v2; publish it.
    const draft = await saveDraft(admin, id, { ...definition, title: { en: "Changed", fr: "Modifié" } });
    expect(draft.version).toBe(2);
    await publish(admin, id, draft.versionId);

    const flows = await availableFlows("dev", { fallback: false });
    expect(flows.find((f) => f.key === key)).toMatchObject({ version: 2, definition: { title: { en: "Changed" } } });
    const [still] = await query<{ flow_version_id: string }>("SELECT flow_version_id FROM analyses WHERE id = $1", [
      a!.id,
    ]);
    expect(still!.flow_version_id).toBe(v1!.id);
    const [old] = await query<{ definition: { title: { en: string } }; status: string }>(
      "SELECT definition, status FROM flow_versions WHERE id = $1",
      [v1!.id],
    );
    expect(old).toMatchObject({ status: "retired", definition: { title: { en: SEED_FLOWS[0]!.definition.title.en } } });
    expect(verifyReport(issued.html, signingKey())).toMatchObject({ ok: true });

    // A new edit opens v3: v2 (published) is never edited.
    const next = await saveDraft(admin, id, { ...definition, title: { en: "Third", fr: "Troisième" } });
    expect(next.version).toBe(3);
    const [v2] = await query<{ definition: { title: { en: string } } }>(
      "SELECT definition FROM flow_versions WHERE id = $1",
      [draft.versionId],
    );
    expect(v2!.definition.title.en).toBe("Changed");
    await setEnvironment(admin, id, "dev", false);
  });

  it("refuses to publish a version that is not a draft", async () => {
    const id = await flowId("lease-check-tenant");
    const [v] = await query<{ id: string }>("SELECT current_version_id AS id FROM flows WHERE id = $1", [id]);
    await expect(publish(admin, id, v!.id)).rejects.toMatchObject({ status: 409 });
  });

  it("enforces a required consent: CONSENT_REQUIRED until it is granted, then the flow runs, then withdrawn it is refused again", async () => {
    const consentFree = await flowId("lease-check-landlord");
    await setEnvironment(admin, consentFree, "dev", false); // the landlord's only consent-free offer is off for this test
    const key = `screening-${stamp}`;
    const { id } = await createFlow(admin, key, { ...SEED_FLOWS[1]!.definition, consents: ["tenant-screening"] });
    const [v] = await query<{ id: string }>("SELECT id FROM flow_versions WHERE flow_id = $1 AND version = 1", [id]);
    await publish(admin, id, v!.id);
    await setEnvironment(admin, id, "dev", true);

    await expect(
      resolveStart({ id: landlord.id, perspective: "landlord" }, "compliance-check", "dev"),
    ).rejects.toMatchObject({ status: 403, body: { code: "CONSENT_REQUIRED", missing: ["tenant-screening"] } });
    await grantConsent(landlord, "tenant-screening");
    expect(await resolveStart({ id: landlord.id, perspective: "landlord" }, "compliance-check", "dev")).toEqual({
      flowVersionId: v!.id,
    });
    await revokeConsent(landlord, "tenant-screening");
    await expect(
      resolveStart({ id: landlord.id, perspective: "landlord" }, "compliance-check", "dev"),
    ).rejects.toMatchObject({ body: { code: "CONSENT_REQUIRED" } });
    const trail = await query<{ action: string }>(
      "SELECT action FROM audit_log WHERE actor_id = $1 AND action LIKE 'consent.%' ORDER BY id",
      [landlord.id],
    );
    expect(trail.map((t) => t.action)).toEqual(["consent.granted", "consent.revoked"]);

    await setEnvironment(admin, id, "dev", false);
    await setEnvironment(admin, consentFree, "dev", true);
  });

  it("refuses a Studio nothing offers: a disabled flow cannot be started (FLOW_NOT_OFFERED)", async () => {
    const free = await flowId("file-check-freelancer");
    await setEnvironment(admin, free, "dev", false);
    await expect(
      resolveStart({ id: landlord.id, perspective: "freelancer" }, "document-authenticity", "dev"),
    ).rejects.toMatchObject({ status: 403, body: { code: "FLOW_NOT_OFFERED" } });
    await setEnvironment(admin, free, "dev", true);
    expect(
      await resolveStart({ id: landlord.id, perspective: "freelancer" }, "document-authenticity", "dev"),
    ).toMatchObject({ flowVersionId: expect.any(String) });
  });

  it("audit-logs every administration action", async () => {
    const trail = await query<{ action: string }>(
      "SELECT DISTINCT action FROM audit_log WHERE actor_id = $1 AND action LIKE 'flow.%'",
      [admin.id],
    );
    expect(trail.map((t) => t.action).sort()).toEqual([
      "flow.created",
      "flow.draft_saved",
      "flow.environment_set",
      "flow.published",
    ]);
  });
});
