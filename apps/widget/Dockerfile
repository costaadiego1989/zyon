# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for @zyon/widget (Vite library preview/testing).
# Build context: monorepo root.
#   docker build -f apps/widget/Dockerfile -t zyon-widget .
#
# Widget is a library (not a service), but this Dockerfile is useful for:
# - Running `vite preview` during CI/testing
# - Local development docker builds
# - Running e2e tests that need the widget preview server
#
# For production, the widget should be built and served from a CDN or static host.

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
COPY apps/widget/package.json               apps/widget/package.json

# 3) Full source
COPY packages/shared-types/ packages/shared-types/
COPY packages/contracts/    packages/contracts/
COPY apps/widget/           apps/widget/

# 4) Install deps
RUN pnpm install --frozen-lockfile

# 5) Build shared packages + widget lib
RUN pnpm --filter @zyon/shared-types build \
 && pnpm --filter @zyon/contracts build \
 && pnpm --filter @zyon/widget build

# ---------------------------------------------------------------------------
# Stage 2: runner (vite preview server)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

ENV NODE_ENV=production
ENV PORT=4173

WORKDIR /app

USER node

# Copy build output and node_modules slim tree
COPY --from=builder --chown=node:node /repo/apps/widget/dist        ./dist
COPY --from=builder --chown=node:node /repo/apps/widget/package.json ./
COPY --from=builder --chown=node:node /repo/node_modules/.pnpm      /repo/node_modules/.pnpm

EXPOSE 4173

# Vite preview: serves dist/ at the configured base path
CMD ["npm", "run", "preview"]
