import { createHash } from "node:crypto";

const PURPOSE = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * The purpose a flow's consent key is stored under in `@krizaka/privacy` (yomizaka#264). A purpose starts with a letter; a key that does
 * not (the old rule, `^[a-z0-9-]{1,40}$`, allowed a digit first) is kept under `k-<8 hex of its md5>`, the very name migration 0051 gave
 * its rows, so no stored consent is lost. A flow now asks only for keys that are purposes.
 */
export const purposeOfKey = (key: string): string => (PURPOSE.test(key) ? key : `k-${createHash("md5").update(key).digest("hex").slice(0, 8)}`);
