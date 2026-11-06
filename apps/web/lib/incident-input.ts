import { INCIDENT_KIND, LEVEL, NOTICE_TARGET } from "@krizaka/privacy";
import { z } from "zod";

/** What the administration may send about an incident (verikora#418). Descriptions hold facts and categories of information, never a person's data. */
const kind = z.enum([INCIDENT_KIND.access, INCIDENT_KIND.use, INCIDENT_KIND.communication, INCIDENT_KIND.loss]);
const level = z.enum([LEVEL.low, LEVEL.medium, LEVEL.high]);

export const openIncidentInput = z.object({
  kind,
  awareAt: z.coerce.date().optional(),
  occurredAt: z.coerce.date().optional(),
  description: z.string().trim().min(1).max(2000),
  information: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  personsConcerned: z.number().int().min(0).optional(),
  drill: z.boolean().optional(),
});

export const incidentStepInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assess"),
    assessment: z.object({
      sensitivity: level,
      consequences: level,
      likelihood: level,
      seriousInjury: z.boolean(),
      rationale: z.string().trim().min(1).max(2000),
    }),
  }),
  z.object({ action: z.literal("measure"), text: z.string().trim().min(1).max(1000) }),
  z.object({
    action: z.literal("notice"),
    target: z.enum([NOTICE_TARGET.cai, NOTICE_TARGET.persons]),
    channel: z.string().trim().min(1).max(40),
    reference: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({ action: z.literal("drill"), drill: z.boolean() }),
  z.object({ action: z.literal("close") }),
]);

export const exportFormat = z.enum(["csv", "json"]);
