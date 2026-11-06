import {
  type AssessmentInput,
  createIncidentRegister,
  type Incident,
  type IncidentActor,
  IncidentError,
  type IncidentInput,
  type IncidentKind,
  type NoticeTarget,
  registerToCsv,
} from "@krizaka/privacy";

import { systemClock } from "../app/system-clock";
import { audit } from "./audit";
import { query } from "./db";
import { refuse } from "./http";

/**
 * The confidentiality incident register (Loi 25, verikora#418) on `@krizaka/privacy`: the administration opens an incident, assesses the
 * risk of serious injury, records the notices to the Commission and to the people concerned, closes it, and exports the register.
 * The register holds the facts and no personal data of the people concerned. Its scope is this product: another scope is never read.
 */
export const INCIDENT_SCOPE = "verikora";

const register = createIncidentRegister({ clock: systemClock });

type Actor = { id: string; email: string };
const who = (actor: Actor): IncidentActor => ({ id: actor.id, label: actor.email });

const STATUS: Record<string, number> = {
  INCIDENT_BAD_INPUT: 400,
  INCIDENT_UNKNOWN: 404,
  INCIDENT_CLOSED: 409,
  INCIDENT_NOT_ASSESSED: 409,
  INCIDENT_NO_NOTICE_DUE: 409,
  INCIDENT_NOTICES_MISSING: 409,
};

/** A refusal of the register becomes the API's answer, with its stable code (the console translates it). */
async function answering<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof IncidentError) throw refuse(STATUS[error.code] ?? 400, error.code, error.message);
    throw error;
  }
}

/** What the console shows of an entry: dates as ISO strings. */
export interface AdminIncident {
  id: string;
  kind: IncidentKind;
  status: Incident["status"];
  awareAt: string;
  description: string;
  information: string[];
  personsConcerned: number | null;
  measures: { at: string; text: string }[];
  assessment: {
    sensitivity: string;
    consequences: string;
    likelihood: string;
    seriousInjury: boolean;
    rationale: string;
    assessedAt: string;
  } | null;
  caiNoticeAt: string | null;
  personsNoticeAt: string | null;
  drill: boolean;
  closedAt: string | null;
  retainUntil: string;
}

export const toAdminIncident = (i: Incident): AdminIncident => ({
  id: i.id,
  kind: i.kind,
  status: i.status,
  awareAt: i.awareAt.toISOString(),
  description: i.description,
  information: i.information,
  personsConcerned: i.personsConcerned,
  measures: i.measures.map((m) => ({ at: m.at.toISOString(), text: m.text })),
  assessment: i.assessment
    ? {
        sensitivity: i.assessment.sensitivity,
        consequences: i.assessment.consequences,
        likelihood: i.assessment.likelihood,
        seriousInjury: i.assessment.seriousInjury,
        rationale: i.assessment.rationale,
        assessedAt: i.assessment.assessedAt.toISOString(),
      }
    : null,
  caiNoticeAt: i.caiNotice?.sentAt.toISOString() ?? null,
  personsNoticeAt: i.personsNotice?.sentAt.toISOString() ?? null,
  drill: i.drill,
  closedAt: i.closedAt?.toISOString() ?? null,
  retainUntil: i.retainUntil.toISOString(),
});

export async function incidentRegister(): Promise<AdminIncident[]> {
  return (await register.list(query, INCIDENT_SCOPE)).map(toAdminIncident);
}

export async function openIncident(
  actor: Actor,
  input: Omit<IncidentInput, "scope">,
  headers?: Headers,
): Promise<AdminIncident> {
  const incident = await answering(register.open(query, { ...input, scope: INCIDENT_SCOPE }, who(actor)));
  await audit({
    action: "privacy.incident_opened",
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: incident.id,
    detail: { drill: incident.drill },
    headers,
  });
  return toAdminIncident(incident);
}

export type IncidentStep =
  | { action: "assess"; assessment: AssessmentInput }
  | { action: "measure"; text: string }
  | { action: "notice"; target: NoticeTarget; channel: string; reference?: string }
  | { action: "drill"; drill: boolean }
  | { action: "close" };

/** One step of an incident's life. Every step is in the audit log, without the description or any person. */
export async function stepIncident(
  actor: Actor,
  id: string,
  step: IncidentStep,
  headers?: Headers,
): Promise<AdminIncident> {
  const by = who(actor);
  const run = (): Promise<Incident> => {
    switch (step.action) {
      case "assess":
        return register.assess(query, INCIDENT_SCOPE, id, step.assessment, by);
      case "measure":
        return register.recordMeasure(query, INCIDENT_SCOPE, id, step.text, by);
      case "notice":
        return register.recordNotice(
          query,
          INCIDENT_SCOPE,
          id,
          step.target,
          { channel: step.channel, ...(step.reference === undefined ? {} : { reference: step.reference }) },
          by,
        );
      case "drill":
        return register.markDrill(query, INCIDENT_SCOPE, id, step.drill, by);
      case "close":
        return register.close(query, INCIDENT_SCOPE, id, by);
    }
  };
  const incident = await answering(run());
  await audit({
    action: `privacy.incident_${step.action}`,
    actorId: actor.id,
    actorLabel: actor.email,
    targetId: id,
    headers,
  });
  return toAdminIncident(incident);
}

/** The register for the Commission, on request: every entry, serious or not, oldest first. Reading it is audited. */
export async function exportIncidentRegister(
  actor: Actor,
  format: "json" | "csv",
  headers?: Headers,
): Promise<{ body: string; type: string; filename: string }> {
  const document = await register.exportRegister(query, INCIDENT_SCOPE);
  await audit({
    action: "privacy.incident_register_exported",
    actorId: actor.id,
    actorLabel: actor.email,
    detail: { format, entries: document.entries.length },
    headers,
  });
  const day = document.generatedAt.slice(0, 10);
  return format === "csv"
    ? {
        body: registerToCsv(document.entries),
        type: "text/csv; charset=utf-8",
        filename: `verikora-incident-register-${day}.csv`,
      }
    : {
        body: JSON.stringify(document, null, 2),
        type: "application/json; charset=utf-8",
        filename: `verikora-incident-register-${day}.json`,
      };
}
