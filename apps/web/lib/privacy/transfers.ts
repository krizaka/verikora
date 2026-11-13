import register from "../../../../docs/privacy/transfers.json";

/** One place personal information goes (docs/privacy/transfers.json). `null` or « not stated » = nobody has proven it yet. */
export type TransferEntry = {
  id: string;
  usedInProduction: boolean;
  where: string | null;
  retention: string | null;
  agreement: string | null;
};
export type TransferRegister = { entries: readonly TransferEntry[] };

const NOT_STATED = /not stated/i;
const FIELDS = ["where", "retention", "agreement"] as const;

const isStated = (value: string | null): boolean => value !== null && value.trim() !== "" && !NOT_STATED.test(value);

/** The register as shipped. */
export const transferRegister: TransferRegister = register;

/** One line per transfer used in production whose place, retention or agreement is empty or « not stated ». */
export function transferProblems(source: TransferRegister = transferRegister): string[] {
  return source.entries
    .filter((entry) => entry.usedInProduction)
    .flatMap((entry) => {
      const missing = FIELDS.filter((field) => !isStated(entry[field]));
      return missing.length
        ? [
            `transfer "${entry.id}" is used in production but its ${missing.join(", ")} is not stated (docs/privacy/transfers.json)`,
          ]
        : [];
    });
}
