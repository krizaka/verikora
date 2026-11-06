/** The sections of /docs, in order: structure only (their words are `docs.sections.<id>`). Each is an anchor of the page and an entry of its contents. */
export const DOCS_SECTIONS = ["check", "api", "data"] as const;
export type DocsSection = (typeof DOCS_SECTIONS)[number];

/** The curl of the quickstart: start a check, then read it. */
export const quickstartCode = (origin: string): string => String.raw`curl -X POST ${origin}/api/v1/checks \
  -H "Authorization: Bearer $VERIKORA_KEY" \
  -F file=@bail.pdf -F check=compliance -F reference=APT-12
# 201 { "check": { "id": "…", "state": "running", … } }

curl ${origin}/api/v1/checks/<id> -H "Authorization: Bearer $VERIKORA_KEY"
# poll until "state" is "done" (the "report" is there), "failed" or "refused"`;

/** The body of an error of the API: the code is stable, the message is for logs. */
export const ERROR_BODY_CODE = `{ "code": "…", "error": "…" }`;

/** The signature of a webhook, and what it signs. */
export const WEBHOOK_SIGNATURE_CODE = `x-krizaka-signature: t=UNIX_SECONDS,v1=HEX

HEX = HMAC-SHA256(endpoint secret, "UNIX_SECONDS.RAW_BODY")`;
