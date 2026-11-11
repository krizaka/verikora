#!/usr/bin/env bash
# The org workflow's `container-smoke`: runs against the image just built (CI_IMAGE). The photo stack — sharp, the HEIC decoder and
# Tesseract in a worker thread — the PDF reader in its worker (pdf.cjs) and OpenDAL's native binary (opendal.cjs) — must work inside it, under the production memory limit (App Platform's smallest instance, 512 MB).
set -euo pipefail
: "${CI_IMAGE:?CI_IMAGE is the image under test}"
docker run --rm --memory=512m -v "$PWD/deploy/docker/smoke:/smoke:ro" --entrypoint node "$CI_IMAGE" /smoke/photos.cjs
docker run --rm --memory=512m -v "$PWD/deploy/docker/smoke:/smoke:ro" --entrypoint node "$CI_IMAGE" /smoke/pdf.cjs
docker run --rm --memory=512m -v "$PWD/deploy/docker/smoke:/smoke:ro" --entrypoint node "$CI_IMAGE" /smoke/opendal.cjs
# The image carries the built server, never the app's sources (krizaka-internal#3010). A filesystem call Turbopack cannot scope (a path built from
# `process.cwd()`) traces the whole project: every .ts file, test and e2e screenshot then ships, and any file added to the repository grows the image.
sources=$(docker run --rm --entrypoint sh "$CI_IMAGE" -c 'find /app -path /app/node_modules -prune -o -path "*/.next" -prune -o -type f \( -name "*.ts" -o -name "*.tsx" \) -print' | wc -l | tr -d ' ')
if [[ "$sources" -gt 0 ]]; then
  echo "The image carries ${sources} TypeScript source files: the build traced the whole project. Read the build's « Dynamic filesystem access causes tracing of the whole project » warning and scope that path (or mark it /*turbopackIgnore: true*/)." >&2
  exit 1
fi
# The image-size budget (deploy/docker/image-size-budget-mb): the uncompressed size of the image just built. Measured 244 MB in CI on 2026-10-29 (was 310 MB on
# the full node image; the « 120 MB » once quoted was the compressed size of a local containerd store, not this figure). OpenDAL's musl binary (+ about 60 MB) raised it to 304 MB measured in CI with it (2026-10-29, verikora#530; budget 310); a dependency that ships a native binary raises it in the same PR, with its reason, never silently.
# It had crept to 310 MB on 2026-11-07 because the whole project was traced (about 11 MB of sources, krizaka-internal#3010); without them the budget is 306 MB, the same 6 MB margin.
budget_mb=$(tr -d '[:space:]' < deploy/docker/image-size-budget-mb)
size_mb=$(( $(docker image inspect "$CI_IMAGE" --format '{{.Size}}') / 1048576 ))
echo "image size: ${size_mb} MB (budget ${budget_mb} MB)"
if [[ "$size_mb" -gt "$budget_mb" ]]; then
  echo "The image is ${size_mb} MB, above its budget of ${budget_mb} MB (deploy/docker/image-size-budget-mb). Remove what grew it, or raise the budget in the PR with the reason." >&2
  exit 1
fi
