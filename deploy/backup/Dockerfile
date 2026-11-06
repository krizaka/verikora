# The nightly backup job (krizaka/verikora#513): node + the PostgreSQL client (pg_dump, pg_restore) + age. Built by DigitalOcean App
# Platform from the repository root as a scheduled job (deploy/digitalocean/dev.app.yaml). No private key is ever in this image or
# its environment: age encrypts to a PUBLIC key (BACKUP_AGE_RECIPIENT).
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /repo
# The client must be at least the server's major version: bin/backup.mjs refuses to run otherwise (plan.mjs, assertDumpClient).
# The distribution's security fixes land between two digest bumps of the base image (CVE-2026-85091, zlib, krizaka-internal#2773).
RUN apk upgrade --no-cache && apk add --no-cache postgresql-client age && corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY deploy/backup/package.json deploy/backup/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @verikora/backup...
COPY deploy/backup deploy/backup
RUN addgroup -S backup && adduser -S backup -G backup
USER backup
ENV NODE_ENV=production
CMD ["node", "deploy/backup/bin/backup.mjs"]
