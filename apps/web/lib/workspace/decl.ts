import type { WorkspaceDecl } from "@krizaka/organize";

/**
 * The organised workspace of Verikora (krizaka-ts ADR-003, verikora#324): the layer of `@krizaka/organize` 0.4 that gives the
 * manager's applicant files, documents, collections and folders tags with a colour marker, the decision status set, saved views and bulk actions.
 * The scope is the manager's account; both kinds are Verikora's own tables, the layer's tables live in the `organize` schema.
 */

/** The kinds the layer organises: the key of each is also the segment of its API (`/api/organize/<kind>/…`). */
export const KIND = {
  applicantFile: "applicant_file",
  document: "document",
  collection: "collection",
  folder: "folder",
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];
export const KINDS: readonly Kind[] = Object.values(KIND);
export const isKind = (value: unknown): value is Kind => KINDS.includes(value as Kind);

/**
 * The kinds that keep their own tag list, status set and configuration (the administration edits these). A collection and a folder
 * share the document list (krizaka-internal#3994): one list for the library, so a tag made on a collection is offered on a document.
 */
export const LIST_KINDS = [KIND.applicantFile, KIND.document] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const isListKind = (value: unknown): value is ListKind => LIST_KINDS.includes(value as ListKind);

/** The role of the account that owns the workspace. There is one today; an organisation's members come with verikora#126. */
export const OWNER_ROLE = "owner";

/** The state the manager reads and the filters name: the keys of the decision set, in one place so no module types a literal. */
export const DECISION = { toDecide: "a_decider", selected: "retenu", notSelected: "non_retenu" } as const;
export type Decision = (typeof DECISION)[keyof typeof DECISION];

export const WORKSPACE: WorkspaceDecl = {
  scope: "accounts",
  users: "accounts",
  kinds: {
    // An applicant file is a `screenings` row of flow « file » (verikora#307): the condition puts it in a manager's scope.
    [KIND.applicantFile]: {
      table: "screenings",
      inScope: "e.landlord_id = $1 AND e.flow = 'file'",
      dateColumn: "created_at",
      textColumns: ["tenant_name"],
    },
    [KIND.document]: {
      table: "documents",
      scopeColumn: "owner_id",
      dateColumn: "created_at",
      textColumns: ["title"],
      collectionColumn: "collection_id",
      // A document matches a tag its collection wears (`filterSql(…, { inherit: true })`).
      containerKind: KIND.collection,
    },
    // A collection and a folder wear the library's list (the document list): same names, markers and uniqueness.
    [KIND.collection]: { table: "collections", scopeColumn: "owner_id", tagList: KIND.document },
    [KIND.folder]: {
      table: "folders",
      inScope: "EXISTS (SELECT 1 FROM collections c WHERE c.id = e.collection_id AND c.owner_id = $1)",
      tagList: KIND.document,
    },
  },
};
