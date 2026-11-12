# Sovkora contract (vendored)

- `compliance-check-inputs.json`: the Studio's input schemas.
- `compliance-check-run.schema.json` + `.sha256`: the shape of a compliance-check run (report 2.x) as Sovkora's edge
  answers it. **Copied byte for byte from `krizaka/sovkora` `contracts/openapi/`** (krizaka-internal#2381). Never edit it
  here: a change starts in Sovkora (schema + `.sha256` there), then the two files are copied here and the pin in
  `lib/sovkora-contract.test.ts` is updated in the same pull request. The test fails if either side changes alone.
