# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the @zyon/api NestJS service.
#
# Build context MUST be the monorepo root (so pnpm workspace files are visible):
#   docker build -f apps/api/Dockerfile -t zyon-api .
#
# Stage 1 (builder) — installs the full workspace, builds shared packages,
# generates the Prisma client, and compiles the NestJS app to dist/.
#
# Stage 2 (runner) — slim production image with prod-only node_modules,
# compiled output, and the Prisma schema (for `prisma migrate deploy` at runtime).

# -----------------------------------------------------------------------------
# Stage 1: builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# pnpm via corepack (matches package.json `packageManager: pnpm@9.15.0`).
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# 1) Copy workspace manifests first for maximum layer-cache reuse.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# 2) Copy every package.json in the workspace so pnpm can resolve the graph.
COPY packages/contracts/package.json        packages/contracts/package.json
COPY packages/shared-types/package.json     packages/shared-types/package.json
COPY packages/commerce-adapters/package.json packages/commerce-adapters/package.json
COPY packages/payments-evm/package.json      packages/payments-evm/package.json
COPY packages/conversation-engine/package.json packages/conversation-engine/package.json
COPY packages/decision-engine/package.json   packages/decision-engine/package.json
COPY packages/negotiation-engine/package.json packages/negotiation-engine/package.json
COPY packages/rules-engine/package.json      packages/rules-engine/package.json
COPY packages/shipping-engine/package.json   packages/shipping-engine/package.json
COPY packages/agentic-checkout-js/package.json packages/agentic-checkout-js/package.json
COPY apps/api/package.json                   apps/api/package.json
COPY apps/widget/package.json                apps/widget/package.json
COPY apps/dashboard/package.json             apps/dashboard/package.json

# 3) Install full workspace deps (dev included — needed for the build).
#    `--filter ...` narrows to the API and its build-time workspace deps so we
#    don't pay for unrelated apps at install time, while still resolving the
#    full graph for the workspace.
RUN pnpm install --frozen-lockfile \
      --filter @zyon/api... \
      --filter @zyon/contracts... \
      --filter @zyon/shared-types... \
      --filter @zyon/commerce-adapters... \
      --filter @zyon/payments-evm... \
      --filter @zyon/conversation-engine... \
      --filter @zyon/decision-engine... \
      --filter @zyon/negotiation-engine... \
      --filter @zyon/rules-engine... \
      --filter @zyon/shipping-engine...

# 4) Copy the rest of the source tree.
COPY packages/ packages/
COPY apps/api/ apps/api/

# 5) Build the API. apps/api/package.json `build` already chains:
#      contracts -> shared-types -> commerce-adapters -> prisma generate -> nest build
RUN pnpm --filter @zyon/api build

# 6) Drop devDependencies so the runner stage can copy a slim tree.
RUN pnpm install --frozen-lockfile --prod \
      --filter @zyon/api... \
      --filter @zyon/contracts... \
      --filter @zyon/shared-types... \
      --filter @zyon/commerce-adapters... \
      --filter @zyon/payments-evm... \
      --filter @zyon/conversation-engine... \
      --filter @zyon/decision-engine... \
      --filter @zyon/negotiation-engine... \
      --filter @zyon/rules-engine... \
      --filter @zyon/shipping-engine...

# -----------------------------------------------------------------------------
# Stage 2: runner
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Run as the non-root `node` user (already present in node:20-alpine).
USER node

# Copy only what runtime needs.
COPY --from=builder --chown=node:node /repo/apps/api/dist          ./dist
COPY --from=builder --chown=node:node /repo/apps/api/node_modules  ./node_modules
COPY --from=builder --chown=node:node /repo/apps/api/prisma         ./prisma
COPY --from=builder --chown=node:node /repo/apps/api/package.json  ./package.json

# Workspace packages may be linked from the api's node_modules; their dist
# output is already part of apps/api/node_modules because pnpm links the
# workspace `packages/*` source. Re-link the workspace package manifests so
# require/import resolution matches the monorepo layout used at build time.
COPY --from=builder --chown=node:node /repo/packages                /repo/packages
COPY --from=builder --chown=node:node /repo/pnpm-workspace.yaml     /repo/pnpm-workspace.yaml
COPY --from=builder --chown=node:node /repo/package.json            /repo/package.json
COPY --from=builder --chown=node:node /repo/pnpm-lock.yaml          /repo/pnpm-lock.yaml
COPY --from=builder --chown=node:node /repo/tsconfig.base.json       /repo/tsconfig.base.json

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/ready || exit 1

# Use exec form so SIGTERM propagates to the Node process.
CMD ["node", "dist/main.js"]