import { expect, it } from "vitest";

import type { DocumentFileStore } from "./document-store";
import { documentStoreContractWith } from "./document-store.contract-kit";

/** What every DocumentFileStore adapter must do (ADR-0007), run by Vitest: the web's, the Mac's. The phone runs the same contract in Jest (`./document-store/contract-kit`). */
export const documentStoreContract = (name: string, make: () => DocumentFileStore | Promise<DocumentFileStore>): void =>
  documentStoreContractWith(name, make, { it, expect });
