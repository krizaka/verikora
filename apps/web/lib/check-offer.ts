import type { Audience } from "@verikora/core";

import { CHECK_KINDS, type CheckKind, rulesetFor, rulesetId } from "./rulesets";

/** The roles whose flows run each kind of check (`rolesOffering` of lib/flows, per kind): what the report tab names when a check is not offered. */
export type RolesByKind = Partial<Record<CheckKind, readonly Audience[]>>;

/** `rolesByKind` from a way to ask « which roles run this ruleset »; a kind with no ruleset in force is left out. */
export function rolesByKind(rolesOf: (ruleset: string) => readonly Audience[], asOf: string): RolesByKind {
  return Object.fromEntries(
    CHECK_KINDS.flatMap((kind) => {
      const choice = rulesetFor(kind, "QC", asOf);
      return choice.verified && choice.ruleset ? [[kind, rolesOf(rulesetId(choice.ruleset))] as const] : [];
    }),
  );
}
