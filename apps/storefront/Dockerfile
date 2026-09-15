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
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# 2) Package manifests
COPY packages/shared-types/package.json     packages/shared-types/package.json
COPY packages/contracts/package.json        packages/contracts/package.json
COPY apps/storefront/package.json           apps/storefront/package.json

# 3) Full source
COPY packages/shared-types/ packages/shared-types/
COPY packages/contracts/    packages/contracts/
COPY apps/storefront/       apps/storefront/

COPY packages/checkout-ui/ packages/checkout-ui/
COPY apps/widget_v2/ apps/widget_v2/

# 4) Install deps
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_WIDGET_BASE_URL
ENV AACP_STANDALONE=true
RUN test -n "$NEXT_PUBLIC_WIDGET_BASE_URL"

# 5) Build
RUN pnpm --filter @zyon/shared-types build \
 && pnpm --filter @zyon/contracts build \
 && pnpm --filter @zyon/widget-v2 build \
 && mkdir -p apps/storefront/public \
 && pnpm --filter @zyon/storefront build

# ---------------------------------------------------------------------------
# Stage 2: runner
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

WORKDIR /app

USER node

# Next.js standalone output
COPY --from=builder --chown=node:node /repo/apps/storefront/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=builder --chown=node:node /repo/apps/storefront/public ./apps/storefront/public

EXPOSE 8080

CMD ["node", "apps/storefront/server.js"]
