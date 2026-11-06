# ADR-0007 — Organising documents, and where they live (two modules, two ports)

Status: accepted (2026-10-22); decision 2 extended by ADR-0012 (bytes out of the database). Issues: krizaka/verikora#163 (organisation), #153 (storage), #164 (info panel), #154 and #155 (Mac, mobile).

## Context
Today a document is a row with its bytes in the database, in a flat list. People need to organise what they keep, and to
choose where it lives: nothing kept (the default), our cloud, their own cloud, or their device. Organisation and storage are
separate responsibilities, and both are separate from the checks (analyses).

## Decision 1 — organisation (`lib/organisation/`, no import from the checks)
- **Model**: an owner (an account today; a B2B workspace when #126 lands, the owner column then becomes the workspace) has
  **libraries**; a library holds **collections**; a collection optionally holds **folders** — **one level only**, to keep it
  simple (a deeper tree is a new ADR). Files live in a collection or in one of its folders; a file with no collection is
  « Sans collection » and appears in « Récents ».
- **Tags** on collections, folders and files: many to many (one join table per target, with real foreign keys), per owner,
  unique by name (case-insensitive), a **colour that is a name** (`blue green amber red violet gray`) mapped to Krizaka UI
  tokens by the UI — never a hex in the database.
- **Deleting a folder or a collection asks what happens to its files**: `move` them up (a folder's files to its collection, a
  collection's files to another collection or to « Sans collection ») or `delete` them. Foreign keys from `documents` are
  `NO ACTION`: a container with files cannot vanish by accident.
- **The URL is the state**: `/app/bibliotheque/[library]/[collection]/[folder]?tags=<id>,<id>` (all selected tags must match).
  Moving, renaming and deleting are API routes (`/api/collections`, `/api/folders`, `/api/tags`, `/api/documents/[id]/placement`).
- Pure rules (`rules.ts`: names, colours, the delete choice, the `tags` parameter, paths) are unit-tested; the SQL
  (`store.ts`) takes its `query` as a parameter and is tested against a real PostgreSQL.

## Decision 2 — storage, the `DocumentStore` port (`lib/storage/`)
- **Port**: `put(key, bytes, meta)`, `get(key)`, `signedUrl(key, ttl)`, `delete(key)`, and `describe()` → where it lives
  (`kind`, `region`, `residency`, `encrypted`, `endpoint`), which the info panel (#164) shows. A contract test runs on every adapter.
- **Adapters are configuration** (the vendor is a value, `STORAGE_PROVIDER`, per workspace as data later): 
  `none` (**the default**: the document is purged after the check, only the report stays; history is optional and chosen by
  the user), `bunny` (dev phase: the existing zone, a private `verikora/…` prefix, signed URLs), `s3` (any S3-compatible
  provider: DigitalOcean Spaces `tor1` in production, or a customer's own bucket, or a local S3 server in CI: SeaweedFS, MinIO no longer publishes images).
- **Residency**: Bunny Storage has **no Canadian region**: it is for **development and fictional data only**; a production
  deployment refuses it. Production is DigitalOcean Spaces `tor1` (Canada), server-side encrypted, 5 USD/month — **the
  owner's go is required**; the adapter is ready, the bucket is not created without it.
- **Bring your own cloud (B2B)**: a workspace admin gives an S3-compatible endpoint, region, bucket and credentials
  (stored encrypted, never shown again), runs a connection test, and sees the data residency; all that workspace's kept files
  then go there. Admin settings per workspace: none / Krizaka cloud / own S3; per user « keep my history » when allowed.
- **Mac and mobile** (#154, #155): a local folder or on-device storage, the same organisation model synced as **metadata
  only**; the files never leave the device.
- **Delete** is immediate and audited; export includes the kept files.

## Consequences
- Checks read a document through the store or the pre-flight bytes, never a table column of the organisation module.
- Each adapter is tested without a paid service (local MinIO in CI).
