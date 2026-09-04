# syntax=docker/dockerfile:1.7
#
# Senior-grade Dockerfile for @zyon/api NestJS service.
#
# Build context: monorepo root.
#   docker build -f apps/api/Dockerfile -t zyon-api .
#
# On Railway, set rootDirectory=. (repo root) + dockerfilePath=apps/api/Dockerfile.
#
# Design principles:
#   - Multi-stage build, distroless runtime (~150 MB final image)
#   - Layer-cache friendly COPY order (manifests → sources → install)
#   - Non-root user, read-only filesystem compatible
#   - Graceful SIGTERM via exec-form CMD
#   - OCI labels for image registry / SBOM tooling
#   - Port + env declared; no secrets baked in

# =============================================================================
# Stage 0 — pnpm toolchain (cached layer reused across all stages)
# =============================================================================
FROM node:20-alpine AS toolchain

ENV PNPM_HOME=/pnpm \
    PNPM_VERSION=9.15.0 \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# =============================================================================
# Stage 1 — dependencies (full workspace install, cached for prod rebuilds)
# =============================================================================
FROM toolchain AS deps

WORKDIR /repo

# Copy workspace manifests first to maximize cache hits when only sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy every package.json in the workspace so pnpm can resolve the dependency graph.
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
COPY apps/widget_v2/package.json             apps/widget_v2/package.json
COPY apps/dashboard/package.json             apps/dashboard/package.json
COPY apps/storefront/package.json            apps/storefront/package.json
COPY apps/web/package.json                   apps/web/package.json

# pnpm install — no cache mount (Railway cache mount ID format is unstable).
RUN pnpm install --frozen-lockfile --prefer-offline

# =============================================================================
# Stage 2 — builder (compile NestJS + generate Prisma client)
# Strategy: copy sources OVER the deps stage using COPY --exclude=node_modules,
# which avoids overlay conflicts with pnpm-created symlinks.
# =============================================================================
FROM deps AS builder

WORKDIR /repo

# Copy fresh source over the deps-installed tree.
# Exclude node_modules so we keep the deps stage's pnpm-installed modules intact.
COPY --exclude=node_modules --exclude=dist packages/ packages/
COPY --exclude=node_modules --exclude=dist apps/api/ apps/api/

# Build chain (contracts → shared-types → commerce-adapters → prisma generate → nest build)
RUN pnpm --filter @zyon/api build

# =============================================================================
# Stage 3 — production-deps (prod-only node_modules for slim runner)
# Fresh install with --prod — no symlink conflicts because we never pnpm install
# before copying sources here.
# =============================================================================
FROM toolchain AS prod-deps

WORKDIR /repo

# Copy manifests and full source BEFORE install — pnpm install needs source present
# to create correct workspace symlinks.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

# Install prod-only deps.
RUN pnpm install --frozen-lockfile --prod \
      --filter @zyon/api...

# =============================================================================
# Stage 4 — runner (distroless, ~150 MB)
# =============================================================================
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runner

LABEL org.opencontainers.image.title="zyon-api" \
      org.opencontainers.image.description="AACP NestJS API" \
      org.opencontainers.image.source="https://github.com/costaadiego1989/zyon" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="Zyon" \
      org.opencontainers.image.version="${APP_VERSION:-0.1.0}"

WORKDIR /app

# distroless image already runs as nonroot (uid 65532). No USER directive needed.
# Read-only filesystem friendly: only /tmp writable; logs go to stdout.

# Compiled NestJS output.
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/dist          ./dist

# Production node_modules (workspace deps resolved via .pnpm store).
COPY --from=prod-deps --chown=nonroot:nonroot /repo/apps/api/node_modules  ./node_modules

# Prisma schema (required for `prisma migrate deploy` at startup).
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/prisma         ./prisma
COPY --from=builder --chown=nonroot:nonroot /repo/apps/api/package.json   ./package.json

# Workspace symlink target (.pnpm store + package manifests) so pnpm-style
# resolution keeps working at runtime.
COPY --from=prod-deps --chown=nonroot:nonroot /repo/node_modules/.pnpm    ./node_modules/.pnpm
COPY --from=prod-deps --chown=nonroot:nonroot /repo/packages               ./packages
COPY --from=builder --chown=nonroot:nonroot /repo/pnpm-workspace.yaml     ./pnpm-workspace.yaml
COPY --from=prod-deps --chown=nonroot:nonroot /repo/package.json          ./package.json
COPY --from=prod-deps --chown=nonroot:nonroot /repo/pnpm-lock.yaml        ./pnpm-lock.yaml
COPY --from=prod-deps --chown=nonroot:nonroot /repo/tsconfig.base.json    ./tsconfig.base.json

ENV NODE_ENV=production \
    PORT=3009 \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=512"

EXPOSE 3009

# exec form → SIGTERM propagates to Node, allowing graceful shutdown
# (NestJS SIGTERM handler drains in-flight requests before exit).
CMD ["dist/main.js"]
