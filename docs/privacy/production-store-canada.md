# Production document store in Canada — plan, switch and checklist (verikora#524)

Slice 6 of ADR-005 (krizaka-ts `docs/adr/ADR-005-storage-providers.md`), under ADR-0007 and ADR-0012 of this repository. The provider is
chosen **in the admin storage screen** (rule « storage configured by the admin »): nothing about it is in an environment variable of
production. The founder opens the account and the bucket; everything else is written and tested.

## 1. The choice, with its facts (checked 2026-10-28; list prices, to confirm when signing)

| | DigitalOcean Spaces `tor1` | AWS S3 `ca-central-1` | OVHcloud `bhs` |
| :--- | :--- | :--- | :--- |
| Where | Toronto, Ontario (outside Québec) | Montréal area, Québec | Beauharnois, Québec |
| Price | USD 5 / month with 250 GiB and 1 TiB out, then 0.02 / GiB stored, 0.01 / GiB out | about 0.023 USD / GB-month, plus requests and traffic | per GB-month, no ingress, egress or API fees |
| Contract | One vendor, one DPA with the app (`tor`) and the PostgreSQL already there | New vendor, AWS customer agreement and DPA | New vendor, OVHcloud Canada (parent in France) |
| Foreign law | US company (CLOUD Act) | US company (CLOUD Act) | French parent |
| Sources | [pricing](https://www.digitalocean.com/pricing/spaces-object-storage), [regions](https://docs.digitalocean.com/products/spaces/details/availability/) | [Montréal launch](https://press.aboutamazon.com/2016/12/amazon-web-services-cloud-now-available-to-customers-from-data-centers-in-canada), [S3 pricing](https://aws.amazon.com/s3/pricing/) | [product](https://www.ovhcloud.com/en-ca/public-cloud/object-storage/), [regions](https://www.ovhcloud.com/en-ca/public-cloud/regions-availability/) |

**Recommended: Spaces `tor1`.** The database already lives in Toronto, so a Québec-only bucket would not take the processing out of the
« outside Québec » case of art. 17; one vendor means one DPA and one assessment for the app, the database and the files; the cost is the
lowest at our size. The bytes are encrypted with our key before they leave (`encryptedStore`): the provider only holds ciphertext, and
only the object key and size are visible to it. The Québec option (OVHcloud `bhs` or AWS `ca-central-1`) is the same `s3` kind with
another preset: the day a customer asks, it is §3's move, not new code.

## 2. What is guarded in the code (tests in this repository)

- Bunny is refused in production at start (`productionProblems`) and hidden from the production form (`adminKinds`).
- **New:** in production a provider becomes the default of the **documents** only when its last connection test passed and found a Canadian
  region (`assertDefaultResidency`, answer `409 STORAGE_NOT_IN_CANADA`, words EN/FR). A foreign, unknown, untested or failed provider cannot
  receive a document in production, even by mistake of the administrator.
- Every document is encrypted with the provider's own key before it leaves; the key is generated when the admin gives none; credentials are sealed
  with `MEDIA_VAULT_KEY`, shown as `set` / `not set`, never returned.
- Signed links live at most 15 minutes (`MAX_SIGNED_URL_SECONDS`).

## 3. The switch (nothing is lost, nothing is deleted before the admin says so)

1. **Founder, once:** apply the `krizaka-infra` PR (bucket `verikora-documents-prod`, private, versioned, TLS only, lifecycle rules, one key limited to that
   bucket); sign the DPA in the DigitalOcean account (checklist §4). The key is created by the stack; read it from the DigitalOcean account, never from git.
2. **Admin screen** (`/admin`, storage): add a provider, kind `s3`, preset DigitalOcean Spaces, region `tor1`, endpoint `https://tor1.digitaloceanspaces.com`,
   bucket, the key pair. The app tests it at once (write, read, compare, delete a probe) and shows « Canada (Ontario) ». The encryption key is generated and sealed.
3. **Set as default for the documents.** New writes go to Spaces. The previous default (Bunny on dev; nothing in production at the opening, so there is nothing to move)
   becomes `retiring` and keeps reading: a read goes new, then old (`dual-read.ts`), so no document disappears while it is moved.
4. **Move** (only if a previous provider holds documents): the admin starts the move. Each batch of 10 copies an object, reads it back, compares its **SHA-256**
   with the original, and only then flips the row's `provider_id` (`provider-move.ts`). It resumes from the database after a crash and never repeats; a mismatch
   stops that document and lists it (« attention »), it is never flipped.
5. **Verify:** the panel's counts reach zero rows on the old provider; the admin opens one document of each kind from Spaces.
6. **Retire** the old provider (confirmation by the admin): refused while any row still reaches it; its old copies are then swept and it is disabled.
7. `docs/privacy/transfers.json` already lists `documents-s3` (Toronto); the day the bucket is live, change `where` / the hosts if they differ and run
   `scripts/privacy-register.test.mjs`.

**Rollback**, at any step before 6: set the previous provider back as the default (it is still verified and reading). Documents already written to Spaces stay
readable through the dual read; run the move the other way (Spaces `retiring`, old default) to bring them back with the same SHA-256 check. After step 6 the old
copies are gone: that is why step 5 is a human check, and why the bucket's versioning (below) keeps a deleted or overwritten object for 30 days.

## 4. The list for the lawyer (EFVP and DPA)

Written in good faith from the act; one review before the public opening (`legal-go-until-lawyer`). Each item says what the repository already states.

- [ ] **EFVP, art. 17** (communication outside Québec): add the bucket to `docs/privacy/efvp.md` and `transfers.md` as a second Toronto processor already assessed for the database; state the sensitivity (leases, pay slips, IDs may be inside a document), the purpose (the check the person asked for, then purge unless they keep it), the protections (client-side encryption, key sealed, private bucket, TLS only, signed links 15 min), the regime of Ontario and the CLOUD Act exposure of a US company. The assessment must exist **before** the first production document.
- [ ] **EFVP, art. 3.3** (new system): the production store is part of the one assessment of verikora#365; the review by the person in charge of personal information is recorded at its end.
- [ ] **DPA with DigitalOcean**: confirm it covers Spaces, names the sub-processors, the breach notice delay, the return and deletion of data at the end, the audit right, and the transfer clauses; keep the signed copy in the company's private folder, never in git.
- [ ] **Written contract with the processor, art. 18.3** (a mandate to a third party): purpose limited to storage, no other use, security measures, notice of a breach, return or destruction at the end.
- [ ] **Retention**: the lifecycle (below) matches `docs/privacy/retention.md`: a purged document leaves no current copy; the 30-day noncurrent version is disclosed in the privacy policy.
- [ ] **Privacy policy and « where your data lives »**: Toronto for the files, in the words of the app (`transfers.md` is the source).
- [ ] **Incident register** (art. 3.5 and following): the bucket's access logs are not kept by us; say how a breach would be detected (the provider's notice, the app's audit trail).
- [ ] **Customer with a Québec requirement**: the OVHcloud `bhs` / AWS `ca-central-1` option, a preset and a move away.

## 5. The infrastructure (krizaka-infra PR, applied by the founder)

A provider-neutral `object-storage` role and its DigitalOcean adapter, and a `stacks/prod/verikora-documents` stack: bucket in `tor1`, private ACL, versioning on, a
policy refusing non-TLS requests, lifecycle rules (abort incomplete multipart uploads after 1 day, expire noncurrent versions after 30 days), and one Spaces key
with `readwrite` on this bucket only. At rest the bytes are ours: encrypted before they leave (the provider's own server-side options are not relied on). `tofu test` covers the role. Nothing is applied by an agent.
