#!/usr/bin/env bash
# The org workflow's `container-smoke`: runs against the image just built (CI_IMAGE). The photo stack — sharp, the HEIC decoder and
# Tesseract in a worker thread — the PDF reader in its worker (pdf.cjs) and OpenDAL's native binary (opendal.cjs) — must work inside it, under the production memory limit (App Platform's smallest instance, 512 MB).
set -euo pipefail
: "${CI_IMAGE:?CI_IMAGE is the image under test}"
docker run --rm --memory=512m -v "$PWD/deploy/docker/smoke:/smoke:ro" --entrypoint node "$CI_IMAGE" /smoke/photos.cjs
docker run --rm --memory=512m -v "$PWD/deploy/docker/smoke:/smoke:ro" --entrypoint node "$CI_IMAGE" /smoke/pdf.cjs
docker run --rm --memory=512m -v "$PWD/deploy/docker/smoke:/smoke:ro" --entrypoint node "$CI_IMAGE" /smoke/opendal.cjs
# The image-size budget (deploy/docker/image-size-budget-mb): the uncompressed size of the image just built. Measured 244 MB in CI on 2026-10-29 (was 310 MB on
# the full node image; the « 120 MB » once quoted was the compressed size of a local containerd store, not this figure). OpenDAL's musl binary (+ about 60 MB) raised it to 304 MB measured in CI with it (2026-10-29, yomizaka#530; budget 310); a dependency that ships a native binary raises it in the same PR, with its reason, never silently.
budget_mb=$(tr -d '[:space:]' < deploy/docker/image-size-budget-mb)
size_mb=$(( $(docker image inspect "$CI_IMAGE" --format '{{.Size}}') / 1048576 ))
echo "image size: ${size_mb} MB (budget ${budget_mb} MB)"
if [ "$size_mb" -gt "$budget_mb" ]; then
  echo "The image is ${size_mb} MB, above its budget of ${budget_mb} MB (deploy/docker/image-size-budget-mb). Remove what grew it, or raise the budget in the PR with the reason." >&2
  exit 1
fi
