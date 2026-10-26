import { z } from "zod";

import { canonicalJson } from "../report";

/**
 * `POST /api/v1/contracts/seal` (yomizaka#71): what a partner platform sends to have a contract sealed. Yomizaka seals what it is
 * given — it checks the shape and the size, never the identities or the law: the partner's statements stay the partner's.
 */
const day = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);

export const party = z
  .object({
    role: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    /** Who signed, as the partner names them: a name, an account of the partner's, or both — at least one. */
    name: text(200).optional(),
    userId: text(100).optional(),
    /** The partner's own reference to the signature (an attestation it holds). */
    attestationId: text(200).optional(),
    signedAt: day,
  })
  .strict()
  .refine((p) => p.name !== undefined || p.userId !== undefined, { message: "A party has a name or an account", path: ["name"] });

export const sealRequest = z
  .object({
    partnerId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    documentType: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
    contractPayload: z.record(z.string(), z.unknown()),
    parties: z.array(party).min(1).max(20),
    /** The framework the partner says it follows: shown on the seal as the partner's own statement. */
    complianceRuleset: text(80),
    /** The language of the seal's words. */
    locale: z.enum(["en", "fr"]).default("fr"),
  })
  .strict()
  .refine((r) => Buffer.byteLength(canonicalJson(r.contractPayload), "utf8") <= 100_000, { message: "The contract's content is over 100 000 bytes", path: ["contractPayload"] });

export type SealRequest = z.infer<typeof sealRequest>;
export type SealParty = z.infer<typeof party>;
