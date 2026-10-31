/*
 * One section map for the web, the phone and the Mac (§ 3.6 of the design direction, yomizaka#319): the same destinations,
 * in the same order, with their labels under the same message key (`sections.<id>`). « Vérifier un document » is not a
 * destination (it is the header's one action), the account lives under the avatar, and search is the top bar's ⌘K palette (B2, P14),
 * not a destination. Structure only: the words are the
 * apps' messages.
 */

export const PLATFORMS = ["web", "phone", "mac"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SECTION_IDS = ["library", "files", "documents", "checks"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The tabs of Vérifications: the checks, then the batches (« Lots »), never a destination of their own. */
export const CHECKS_TABS = ["checks", "lots"] as const;
export type ChecksTab = (typeof CHECKS_TABS)[number];

export interface Section {
  id: SectionId;
  /** The address on the web, under the language (`/fr/app/verifications`); the apps follow the same paths. */
  path: string;
  /** The tabs the destination holds. */
  tabs?: readonly ChecksTab[];
  /** Shown only to the people offered the applicant-file flow. */
  gated?: "applicantFiles";
  /** Why a platform does not have this destination yet (the parity rule: say why, never a different map). */
  pending: Partial<Record<Platform, string>>;
}

const NO_APPLICANT_SCREEN =
  "the applicant files' list and detail are on the web first (P6); @yomizaka/client has no applications call yet";
const FROM_THE_HOME =
  "two items are enough (krizaka-internal#2001): the web rail holds Home and Checks, and the home lists the dossiers and reaches the documents";
const NO_DOCUMENTS_LIST =
  "the list of all the documents is on the web first (P14, the B2 shell); the phone and the Mac reach them through the library";

export const SECTIONS: readonly Section[] = [
  { id: "library", path: "/app", pending: {} },
  {
    id: "files",
    path: "/app/dossiers",
    gated: "applicantFiles",
    pending: { web: FROM_THE_HOME, phone: NO_APPLICANT_SCREEN, mac: NO_APPLICANT_SCREEN },
  },
  {
    id: "documents",
    path: "/app/documents",
    pending: { web: FROM_THE_HOME, phone: NO_DOCUMENTS_LIST, mac: NO_DOCUMENTS_LIST },
  },
  { id: "checks", path: "/app/verifications", tabs: CHECKS_TABS, pending: {} },
];

/** The destinations a platform draws, in the map's order: the gated ones only when offered, none a platform lacks. */
export function sectionsFor(platform: Platform, offer: { applicantFiles?: boolean } = {}): Section[] {
  return SECTIONS.filter((s) => !s.pending[platform] && (!s.gated || offer[s.gated] === true));
}

/** The keyboard shortcut of the n-th destination shown (0-based): ⌘1 to ⌘4. */
export function sectionShortcut(index: number): `mod+${number}` {
  if (!Number.isInteger(index) || index < 0 || index >= SECTION_IDS.length)
    throw new RangeError(`no shortcut for section ${index}`);
  return `mod+${index + 1}`;
}
