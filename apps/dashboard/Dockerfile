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
# Stage 2: runner (nginx-unprivileged, static SPA)
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

LABEL org.opencontainers.image.title="zyon-dashboard" \
      org.opencontainers.image.description="AACP merchant dashboard (React SPA)" \
      org.opencontainers.image.source="https://github.com/costaadiego1989/zyon" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="Zyon"

USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /repo/apps/dashboard/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
