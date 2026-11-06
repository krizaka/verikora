import { createIncidentRegister, memoryIncidentStore } from "@krizaka/privacy";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  current: null as unknown as ReturnType<typeof import("@krizaka/privacy").memoryIncidentStore>,
}));
const audited = vi.hoisted(() => [] as { action: string; detail?: unknown }[]);

vi.mock("@krizaka/privacy", async (original) => {
  const real = await original<typeof import("@krizaka/privacy")>();
  return {
    ...real,
    createIncidentRegister: (deps: Parameters<typeof real.createIncidentRegister>[0]) =>
      real.createIncidentRegister({ ...deps, storeFor: () => store.current }),
  };
});
vi.mock("./audit", () => ({ audit: async (entry: { action: string; detail?: unknown }) => void audited.push(entry) }));
vi.mock("./db", () => ({ query: async () => ({ rows: [] }) }));

import { exportIncidentRegister, INCIDENT_SCOPE, incidentRegister, openIncident, stepIncident } from "./incidents";

const admin = { id: "a1", email: "admin@verikora.test" };
const input = {
  kind: "access" as const,
  description: "A shared link stayed public.",
  information: ["lease"],
  personsConcerned: 2,
};
const serious = {
  action: "assess" as const,
  assessment: {
    sensitivity: "high" as const,
    consequences: "high" as const,
    likelihood: "medium" as const,
    seriousInjury: true,
    rationale: "Leases name the tenants.",
  },
};

beforeEach(() => {
  store.current = memoryIncidentStore();
  audited.length = 0;
});

describe("the incident register of the administration (Loi 25, verikora#418)", () => {
  it("opens, assesses, notifies both, closes - and audits every step without the description", async () => {
    const opened = await openIncident(admin, input);
    expect(opened.status).toBe("open");
    await stepIncident(admin, opened.id, serious);
    await stepIncident(admin, opened.id, { action: "notice", target: "cai", channel: "form" });
    await stepIncident(admin, opened.id, { action: "notice", target: "persons", channel: "email" });
    const closed = await stepIncident(admin, opened.id, { action: "close" });
    expect(closed.status).toBe("closed");
    expect(audited.map((a) => a.action)).toEqual([
      "privacy.incident_opened",
      "privacy.incident_assess",
      "privacy.incident_notice",
      "privacy.incident_notice",
      "privacy.incident_close",
    ]);
    expect(JSON.stringify(audited)).not.toContain("shared link");
  });

  it("refuses to close before the notices, with the register's code as the status", async () => {
    const { id } = await openIncident(admin, input);
    await expect(stepIncident(admin, id, { action: "close" })).rejects.toMatchObject({
      status: 409,
      body: { code: "INCIDENT_NOT_ASSESSED" },
    });
    await stepIncident(admin, id, serious);
    await expect(stepIncident(admin, id, { action: "close" })).rejects.toMatchObject({
      status: 409,
      body: { code: "INCIDENT_NOTICES_MISSING" },
    });
  });

  it("answers 404 for an unknown incident and 400 for a bad input", async () => {
    await expect(
      stepIncident(admin, "00000000-0000-4000-8000-000000000000", { action: "close" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(openIncident(admin, { ...input, description: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("exports the register as CSV and JSON, and audits the export", async () => {
    await openIncident(admin, input);
    const csv = await exportIncidentRegister(admin, "csv");
    expect(csv.type).toContain("text/csv");
    expect(csv.filename).toMatch(/^verikora-incident-register-\d{4}-\d{2}-\d{2}\.csv$/);
    const json = await exportIncidentRegister(admin, "json");
    expect(JSON.parse(json.body).entries).toHaveLength(1);
    expect(audited.filter((a) => a.action === "privacy.incident_register_exported")).toHaveLength(2);
  });
});

describe("tenant isolation: another scope's register is neither read nor written", () => {
  const register = createIncidentRegister({ clock: { now: () => new Date() } });
  const other = { id: "z1", label: "admin@folioviv.test" };

  it("never lists the entries of another scope", async () => {
    await register.open(async () => ({ rows: [] }) as never, { ...input, scope: "folioviv" }, other);
    await openIncident(admin, input);
    const mine = await incidentRegister();
    expect(mine).toHaveLength(1);
    expect(INCIDENT_SCOPE).toBe("verikora");
  });

  it("cannot step, close or export an incident of another scope", async () => {
    const foreign = await register.open(async () => ({ rows: [] }) as never, { ...input, scope: "folioviv" }, other);
    await expect(stepIncident(admin, foreign.id, serious)).rejects.toMatchObject({ status: 404 });
    await expect(stepIncident(admin, foreign.id, { action: "close" })).rejects.toMatchObject({ status: 404 });
    expect(JSON.parse((await exportIncidentRegister(admin, "json")).body).entries).toHaveLength(0);
    const untouched = await store.current.get("folioviv", foreign.id);
    expect(untouched?.status).toBe("open");
  });
});
