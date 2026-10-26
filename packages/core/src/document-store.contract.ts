import { expect, it } from "vitest";

import type { DocumentStore } from "./document-store";
import { documentStoreContractWith } from "./document-store.contract-kit";

/** What every DocumentStore adapter must do (ADR-0007), run by Vitest: the web's, the Mac's. The phone runs the same contract in Jest (`./document-store/contract-kit`). */
export const documentStoreContract = (name: string, make: () => DocumentStore | Promise<DocumentStore>): void => documentStoreContractWith(name, make, { it, expect });
