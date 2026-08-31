# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for @zyon/storefront (Next.js).
# Build context: monorepo root.
#   docker build -f apps/storefront/Dockerfile -t zyon-storefront .

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# 1) Workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# 2) Package manifests
COPY packages/shared-types/package.json     packages/shared-types/package.json
COPY packages/contracts/package.json        packages/contracts/package.json
COPY apps/storefront/package.json           apps/storefront/package.json

# 3) Full source
COPY packages/shared-types/ packages/shared-types/
COPY packages/contracts/    packages/contracts/
COPY apps/storefront/       apps/storefront/

# 4) Install deps
RUN pnpm install --frozen-lockfile

# 5) Build
RUN pnpm --filter @zyon/shared-types build \
 && pnpm --filter @zyon/contracts build \
 && pnpm --filter @zyon/storefront build

# ---------------------------------------------------------------------------
# Stage 2: runner
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

USER node

# Next.js standalone output
COPY --from=builder --chown=node:node /repo/apps/storefront/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/storefront/.next/static ./.next/static
COPY --from=builder --chown=node:node /repo/apps/storefront/public ./public

EXPOSE 3001

CMD ["node", "server.js"]
