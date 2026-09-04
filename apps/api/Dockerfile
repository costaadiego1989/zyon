# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the @zyon/api NestJS service.
#
# Build context: monorepo root.
#   docker build -f apps/api/Dockerfile -t zyon-api .
#
# Strategy:
#   Stage 1 (builder): install deps, build workspace packages + api, then
#                       `pnpm deploy` to flatten node_modules.
#   Stage 2 (runner):  minimal node:20-alpine, copy from /deploy.
#
# Why `pnpm deploy`:
#   `pnpm install` creates symlinks pointing at host absolute paths
#   (e.g. /repo/packages/...). Across Docker COPY stages, those symlinks
#   point to nonexistent paths in the runner layer. `pnpm deploy`
#   materializes a fully flat node_modules tree (no symlinks, no .pnpm/
#   store) that runtime Node can resolve correctly in any environment.

# =============================================================================
# Stage 1: builder
# =============================================================================
FROM node:20-alpine AS builder

ENV PNPM_HOME=/pnpm \
    PNPM_VERSION=9.15.0 \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# Workspace manifests first (cache hit when only sources change).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Each package.json lets pnpm resolve the workspace graph.
COPY packages/contracts/package.json         packages/contracts/package.json
COPY packages/shared-types/package.json      packages/shared-types/package.json
COPY packages/commerce-adapters/package.json packages/commerce-adapters/package.json
COPY packages/payments-evm/package.json      packages/payments-evm/package.json
COPY packages/conversation-engine/package.json packages/conversation-engine/package.json
COPY packages/decision-engine/package.json   packages/decision-engine/package.json
COPY packages/negotiation-engine/package.json packages/negotiation-engine/package.json
COPY packages/rules-engine/package.json      packages/rules-engine/package.json
COPY packages/shipping-engine/package.json   packages/shipping-engine/package.json
COPY packages/agentic-checkout-js/package.json packages/agentic-checkout-js/package.json
COPY packages/sdk/package.json               packages/sdk/package.json
COPY packages/checkout-ui/package.json       packages/checkout-ui/package.json
COPY apps/api/package.json                   apps/api/package.json

# Install full workspace deps. --prefer-offline avoids re-downloading
# already-cached tarballs while still allowing the lockfile to drift
# (the committed lockfile is often out of sync with package.json edits).
RUN pnpm install --prefer-offline

# Full source. pnpm install above created symlinks (workspace:* → .pnpm).
# Clean per-package node_modules before overlaying fresh source — overlay
# can't replace a symlink with a regular file from host.
RUN find packages apps -type d -name node_modules -prune -exec rm -rf {} +

COPY packages/ packages/
COPY apps/api/ apps/api/

# Re-install to recreate node_modules with the fresh source present.
RUN pnpm install --prefer-offline

# Build api. Build script chains: contracts -> shared-types -> ... -> nest build.
RUN pnpm --filter @zyon/api build

# Materialize a self-contained, symlink-free layout at /deploy.
RUN pnpm --filter @zyon/api --prod deploy /deploy

# =============================================================================
# Stage 2: runner
# =============================================================================
FROM node:20-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3009

WORKDIR /app

USER node

# Copy the deployed artifacts. /deploy contains the api package flat:
#   - dist/             (compiled NestJS)
#   - node_modules/     (flat, runtime-resolvable, no symlinks)
#   - prisma/
#   - package.json
COPY --from=builder --chown=node:node /deploy/dist          ./dist
COPY --from=builder --chown=node:node /deploy/node_modules  ./node_modules
COPY --from=builder --chown=node:node /deploy/prisma         ./prisma
COPY --from=builder --chown=node:node /deploy/package.json  ./package.json

EXPOSE 3009

CMD ["node", "dist/main.js"]
