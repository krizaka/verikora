# Yomizaka web (Next.js standalone) — built by DigitalOcean App Platform from the repository root.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
ARG APP_COMMIT_SHA=""
# The static pages (landing, privacy) bake the indexing flag at build: App Platform passes build variables as build args.
ARG APP_SEARCH_INDEXING=""
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA APP_SEARCH_INDEXING=$APP_SEARCH_INDEXING NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @yomizaka/web build
# The OCR (Tesseract) runs in a worker thread whose requires the build's tracing cannot see: carry its packages, with their
# trained data (French, English) and the few they need, whole and with their symlinks (ADR-0010). The PDF reader (`unpdf`) is carried the same
# way: its worker finds it by folder (lib/extraction/package-dir.ts), no longer by a `require.resolve` the tracer followed. The smoke check proves it.
RUN mkdir /ocr && cd node_modules/.pnpm && cp -a $(ls | grep -E '^(tesseract\.js|tesseract\.js-core|bmp-js|idb-keyval|is-url|node-fetch|opencollective-postinstall|regenerator-runtime|wasm-feature-detect|zlibjs|tr46|whatwg-url|webidl-conversions)@|^@tesseract\.js-data\+|^unpdf@') /ocr/
# Not shipped (about 35 MB): the browser builds of the core (`*.wasm.js`, the same WebAssembly embedded for a page; Node reads the `.wasm`)
# and the fast-model data (only `4.0.0_best_int` is read, lib/ocr/tesseract.ts). The smoke check reads a page, so a mistake here fails the build.
RUN cd /ocr && find . -path '*/tesseract.js-core@*' -name '*.wasm.js' -delete \
    && find . -path '*/@tesseract.js-data/*' -mindepth 4 -maxdepth 6 -type d -name 4.0.0 -exec rm -rf {} +

# The runtime starts `node` only: it is Alpine plus the node binary of the build stage's image (musl, same version) and its two
# libraries. npm, corepack, yarn and the headers (and the dependencies they bundle, flagged by the image scan) are never in a layer.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
RUN apk add --no-cache libstdc++ libgcc && addgroup -S yomizaka && adduser -S yomizaka -G yomizaka
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build --chown=yomizaka:yomizaka /repo/apps/web/.next/standalone ./
COPY --from=build --chown=yomizaka:yomizaka /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=yomizaka:yomizaka /ocr/ ./node_modules/.pnpm/
USER yomizaka
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
