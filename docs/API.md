# Verikora API v1

Check a lease or an invoice from your own tool (an ERP, a property-management system, a script). A check is an Sovkora run;
the report is returned as Sovkora produced it (in French). **Verikora is a triage tool, not legal advice.**

- Contract: [`/api/v1/openapi.json`](https://www.verikora.com/api/v1/openapi.json) (OpenAPI 3.1, generated from the code; a test refuses a route that is not in it).
- Access: a **Pro** plan; the keys are created in the account. `Authorization: Bearer yzk_…`. A key has scopes
  (`checks:write` to start, `reports:read` to read), a life of 1 to 365 days, a rotation with a 24 h grace, and a per-minute
  limit set by the administrator (429 with `Retry-After`). Never put a key in a repository or a log.
- Errors: `{ "code": "…", "error": "…" }`, the code is stable (`API_KEY_MISSING`/`_INVALID`/`_EXPIRED`/`_REVOKED`/`_SUPERSEDED` 401,
  `API_KEY_SCOPE`/`API_PLAN`/`FEATURE_OFF` 403, `NOT_FOUND` 404, `BAD_REQUEST` 400, `BATCH_EMPTY` 422, 429).

## One check

```sh
curl -X POST https://www.verikora.com/api/v1/checks \
  -H "Authorization: Bearer $VERIKORA_KEY" \
  -F file=@bail.pdf -F check=compliance -F reference=APT-12
# 201 { "check": { "id": "…", "state": "running", … } }

curl https://www.verikora.com/api/v1/checks/<id> -H "Authorization: Bearer $VERIKORA_KEY"
# poll until "state" is "done" (the "report" is there), "failed" or "refused"
```

`check`: `compliance` (the text against the jurisdiction's rules, Québec by default) or `authenticity` (the file examined as a
file); the French words `conformite` / `authenticite` work too. States: `pending` (waits: see `error`, e.g. `PAYWALL`),
`running`, `reused` (an identical earlier check, free), `done`, `failed`, `refused` (`error` says why: `UNKNOWN_CHECK`,
`NO_TEXT`, `NOT_A_PDF`…). A check is a batch of one row: same path, same refusals.

## A batch

```sh
curl -X POST https://www.verikora.com/api/v1/batches -H "Authorization: Bearer $VERIKORA_KEY" \
  -F manifest=@immeuble.csv -F files=@bail-1.pdf -F files=@bail-2.pdf
curl https://www.verikora.com/api/v1/batches/<id> -H "Authorization: Bearer $VERIKORA_KEY"
```

The CSV (`file`, `check`, and optionally `documentType`, `jurisdiction`, `ruleset`, `expectedIssuer`, `reference`, `collection`; the
separator may be `,` `;` or a tab) is the one of the web page, with its template. Each row has its own state and `error`;
a failed row never stops the others. Reading a check or a batch advances it (up to the workspace's concurrency).

## The reports in one archive

```sh
curl "https://www.verikora.com/api/v1/batches/<id>/export?lang=fr" -H "Authorization: Bearer $VERIKORA_KEY" -o rapports.zip
```

`lot.csv` (every row: state, the reason when it did not run, its file), `rapports/` (the **signed PDF** of each compliance row, in `lang`
`fr` or `en`: the same file the page offers, verifiable on the verification page), `signaux/` (the signals of each authenticity row, as
Sovkora returned them) and `LISEZ-MOI.txt`. A row whose report cannot be issued (not ready, translation pending) is listed with its reason, never
silently missing. An archive past `limits.batchExportMaxMb` (50 MB by default) is refused with 413 `EXPORT_TOO_LARGE`. On the batch page it is the
« Rapports (ZIP) » button.

## Audit

Every call that starts or reads a check or a batch is recorded in the audit log as `api.check.created`, `api.check.read`,
`api.batch.created`, `api.batch.read`, by `api-key:<key id>` (never the key). A key's last use is kept by `@krizaka/api-keys`.

## Webhooks

Instead of polling, register an endpoint and Verikora calls it when work finishes (Pro, like the keys; the plan's number of endpoints
and the global switch are an administrator's settings). Endpoints are managed with your session, not with an API key:

```sh
POST   /api/me/webhooks                 { "url": "https://erp.example.com/verikora", "events": ["batch.finished", "check.finished"] }
# 201 { "endpoint": { "id": "…" }, "secret": "whsec_…" }   the secret is shown once; at rest it is sealed
GET    /api/me/webhooks                 your endpoints, the events, your plan's allowance (never a secret)
PATCH  /api/me/webhooks/{id}            { "events": [...] } or { "active": false }
POST   /api/me/webhooks/{id}/rotate     a new secret (the old one stops signing at once)
GET    /api/me/webhooks/{id}/deliveries what was sent and how it went
DELETE /api/me/webhooks/{id}
```

The address must be **https** and public (never a private or internal address, checked again at every send, no redirect followed).
Events: `batch.finished` (every row is done, failed or refused) and `check.finished` (a check started with `POST /api/v1/checks`).
The payload has ids, states, your own `reference` and the reason of a row — **never a document, a quoted passage or a report**; read
those with `GET /api/v1/checks/{id}` and your key.

Each request carries `x-krizaka-event`, `x-krizaka-event-id` (stable: apply an event once) and `x-krizaka-signature: t=<unix seconds>,v1=<hex>`
where `v1` is the HMAC-SHA256, with your secret, of `"<t>.<raw body>"`. Verify it over the raw body and refuse an old `t`. Any non-2xx answer
(or no answer within 8 s) is retried after 30 s, 5 min, 30 min, 2 h and 12 h (the number of tries is a setting, 6 by default); after the last
it is given up and stays in the deliveries log. Deliveries go out with the server's tick: if an administrator turns the tick off
(`limits.batchTickSeconds` = 0) nothing is sent. The OpenAPI document describes both events under `webhooks`.

## Not yet

Signed PDF of a report, a ZIP of the reports (verikora#202, #242).
