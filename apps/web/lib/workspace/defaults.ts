import type { KindConfig, StatusSet } from "@krizaka/organize";

import { DECISION, KIND, type Kind, OWNER_ROLE } from "./decl";

/**
 * What the database is seeded with, once (`config.seed`, never overwriting): afterwards the database is the source of truth and the
 * administration changes it (`config.put`, versioned). The words are data in both languages, read with the locale key.
 *
 * The decision is the manager's, never the engine's: no reasons (no free text about a person is accepted, and no list yet), no
 * suggestion. Both targets are final (the file closes and its documents are purged, Loi 25), and refusing needs two presses.
 */
export const DECISION_SET: StatusSet = {
  key: "decision",
  label: { fr: "Votre décision", en: "Your decision" },
  mode: "editable",
  states: [
    { key: DECISION.toDecide, label: { fr: "À décider", en: "To decide" }, tone: "warning" },
    { key: DECISION.selected, label: { fr: "Retenu", en: "Selected" }, tone: "success", final: true },
    // A person's decision never wears `danger`: « Non retenu » is the manager's word, not a fault (design § 5.3).
    { key: DECISION.notSelected, label: { fr: "Non retenu", en: "Not selected" }, tone: "neutral", final: true },
  ],
  initial: DECISION.toDecide,
  transitions: [
    { from: DECISION.toDecide, to: DECISION.selected, roles: [OWNER_ROLE] },
    { from: DECISION.toDecide, to: DECISION.notSelected, roles: [OWNER_ROLE], confirm: true },
  ],
};

/** The tags of a kind: the owner writes them, up to this many a kind; the administration's presets are copied in for a new account. */
// @fixed: a manager's own tags (a building, a guarantor): fifty is far more than a list can use, and the package's ceiling is 200.
const TAGS_PER_KIND = 50;

const tags = { writers: [OWNER_ROLE], userTags: true, max: TAGS_PER_KIND, presets: { default: [] } } as const;

export const DEFAULT_CONFIGS: Record<Kind, KindConfig> = {
  [KIND.applicantFile]: {
    kind: KIND.applicantFile,
    tags: { ...tags, writers: [...tags.writers], presets: { default: [] } },
    status: DECISION_SET,
    views: [
      { key: "to_decide", label: { fr: "À décider", en: "To decide" }, filters: { status: [DECISION.toDecide] } },
      {
        key: "decided",
        label: { fr: "Décidés", en: "Decided" },
        filters: { status: [DECISION.selected, DECISION.notSelected] },
      },
    ],
  },
  // Documents carry tags only: a document already has Sovkora's fact (« À regarder », « Aucun problème trouvé… »), and a second,
  // user-made status on the same row would compete with it (design § 4).
  [KIND.document]: {
    kind: KIND.document,
    tags: { ...tags, writers: [...tags.writers], presets: { default: [] } },
    status: null,
    views: [],
  },
};
