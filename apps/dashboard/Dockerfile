# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for @zyon/dashboard (Vite + React SPA).
# Build context: monorepo root.
#   docker build -f apps/dashboard/Dockerfile -t zyon-dashboard .

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# 1) Workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# 2) Package manifests (only what the dashboard needs)
COPY packages/shared-types/package.json     packages/shared-types/package.json
COPY packages/contracts/package.json        packages/contracts/package.json
COPY apps/dashboard/package.json            apps/dashboard/package.json

# 3) Full source
COPY packages/shared-types/ packages/shared-types/
COPY packages/contracts/    packages/contracts/
COPY apps/dashboard/        apps/dashboard/

# 4) Install deps
RUN pnpm install --frozen-lockfile

# 5) Build shared packages + dashboard
RUN pnpm --filter @zyon/shared-types build \
 && pnpm --filter @zyon/contracts build \
 && pnpm --filter @zyon/dashboard build

# ---------------------------------------------------------------------------
# Stage 2: runner (static files served by nginx)
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Add custom nginx config for SPA routing
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /repo/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
