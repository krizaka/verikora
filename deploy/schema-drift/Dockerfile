# The nightly schema check of verikora-dev (krizaka-internal#4881): one bundled file (pg and lib/schema-expected.json inside), run by `node`.
# Built by DigitalOcean App Platform from the repository root as a scheduled job (deploy/digitalocean/dev.app.yaml).
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web apps/web
COPY packages/core packages/core
RUN pnpm --filter @verikora/web exec esbuild scripts/schema-drift.mts --bundle --platform=node --format=esm --target=node22 \
    --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
    --outfile=/out/schema-drift.mjs

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /app
COPY --from=build /out/schema-drift.mjs ./schema-drift.mjs
RUN addgroup -S drift && adduser -S drift -G drift
USER drift
ENV NODE_ENV=production
CMD ["node", "schema-drift.mjs"]
