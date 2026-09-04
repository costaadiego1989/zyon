# syntax=docker/dockerfile:1.7
#
# Senior-grade Dockerfile for @zyon/api NestJS service.
#
# Build context: apps/api/ directory.
#   docker build -f apps/api/Dockerfile -t zyon-api apps/api
#
# On Railway:
#   - rootDirectory=apps/api
#   - dockerfilePath=Dockerfile (no apps/api/ prefix — path is relative to rootDirectory)
#
# Design principles:
#   - Multi-stage build, distroless runtime (~150 MB final image)
#   - Layer-cache friendly: copy all manifests + sources first, then pnpm install
#   - Non-root user (distroless)
#   - Graceful SIGTERM via exec-form CMD

# =============================================================================
# Stage 0 — pnpm toolchain
# =============================================================================
FROM node:20-alpine AS toolchain

ENV PNPM_HOME=/pnpm \
    PNPM_VERSION=9.15.0 \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# =============================================================================
# Stage 1 — builder
# Context is apps/api/. We go UP to monorepo root (../..) for workspace files.
# =============================================================================
FROM toolchain AS builder

WORKDIR /repo

# Workspace manifests (from monorepo root).
COPY ../../package.json ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../tsconfig.base.json ./

# Workspace package manifests (from monorepo root).
COPY ../../packages/contracts/package.json         packages/contracts/package.json
COPY ../../packages/shared-types/package.json      packages/shared-types/package.json
COPY ../../packages/commerce-adapters/package.json packages/commerce-adapters/package.json
COPY ../../packages/payments-evm/package.json      packages/payments-evm/package.json
COPY ../../packages/conversation-engine/package.json packages/conversation-engine/package.json
COPY ../../packages/decision-engine/package.json   packages/decision-engine/package.json
COPY ../../packages/negotiation-engine/package.json packages/negotiation-engine/package.json
COPY ../../packages/rules-engine/package.json      packages/rules-engine/package.json
COPY ../../packages/shipping-engine/package.json   packages/shipping-engine/package.json
COPY ../../packages/agentic-checkout-js/package.json packages/agentic-checkout-js/package.json
COPY ../../packages/sdk/package.json               packages/sdk/package.json
COPY ../../packages/checkout-ui/package.json       packages/checkout-ui/package.json
COPY ./package.json                                 apps/api/package.json

# Install dev deps. pnpm creates symlinks — no COPY follows this, so no conflicts.
RUN pnpm install --frozen-lockfile --prefer-offline

# Copy full sources (workspace packages + this api).
COPY ../../packages/ packages/
COPY ./ apps/api/

# Build the API.
RUN pnpm --filter @zyon/api build

# =============================================================================
# Stage 2 — runner (distroless)
# =============================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runner

LABEL org.opencontainers.image.title="zyon-api" \
      org.opencontainers.image.description="AACP NestJS API" \
      org.opencontainers.image.source="https://github.com/costaadiego1989/zyon" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="Zyon"

WORKDIR /app

# Compiled output.
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/dist          ./dist

# node_modules (dev deps present — for now this is OK, can be optimized to --prod later).
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/node_modules  ./node_modules

# Prisma + package metadata.
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/prisma         ./prisma
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/package.json   ./package.json

# Workspace links.
COPY --from=builder --chown=nonroot:nonroot /repo/node_modules/.pnpm    ./node_modules/.pnpm
COPY --from=builder --chown=nonroot:nonroot /repo/packages               ./packages
COPY --from=builder --chown=nonroot:nonroot /repo/pnpm-workspace.yaml     ./pnpm-workspace.yaml
COPY --from=builder --chown=nonroot:nonroot /repo/package.json          ./package.json
COPY --from=builder --chown=nonroot:nonroot /repo/pnpm-lock.yaml        ./pnpm-lock.yaml
COPY --from=builder --chown=nonroot:nonroot /repo/tsconfig.base.json    ./tsconfig.base.json

ENV NODE_ENV=production \
    PORT=3009 \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=512"

EXPOSE 3009

CMD ["dist/main.js"]
