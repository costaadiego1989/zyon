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
#   - Layer-cache friendly: sources copied together before pnpm install
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
# Stage 1 — builder (compile NestJS + generate Prisma client)
# Copy sources FIRST, then pnpm install. pnpm creates symlinks in the source
# tree; subsequent COPYs in the same stage don't conflict because no COPY
# follows after pnpm install.
# =============================================================================
FROM toolchain AS builder

WORKDIR /repo

# Copy everything in one go — manifests + sources + packages.
# Single layer for all sources = maximum cache efficiency.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/widget_v2/ apps/widget_v2/
COPY apps/dashboard/ apps/dashboard/
COPY apps/storefront/ apps/storefront/
COPY apps/web/ apps/web/

# Install dev + workspace deps (this creates symlinks; no COPY after this point
# in this stage, so no overlay conflicts).
RUN pnpm install --frozen-lockfile --prefer-offline

# Build chain (contracts → shared-types → commerce-adapters → prisma generate → nest build)
RUN pnpm --filter @zyon/api build

# =============================================================================
# Stage 2 — production-deps (prod-only node_modules for slim runner)
# =============================================================================
FROM toolchain AS prod-deps

WORKDIR /repo

# Copy manifests + sources before install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/widget_v2/ apps/widget_v2/
COPY apps/dashboard/ apps/dashboard/
COPY apps/storefront/ apps/storefront/
COPY apps/web/ apps/web/

# Install prod-only deps (no COPY after this point).
RUN pnpm install --frozen-lockfile --prod \
      --filter @zyon/api...

# =============================================================================
# Stage 3 — runner (distroless, ~150 MB)
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
