# syntax=docker/dockerfile:1.7
#
# Senior-grade Dockerfile for @zyon/widget-v2 (Vite + React SPA checkout widget).
# Build from monorepo root:
#   docker build -f apps/widget_v2/Dockerfile -t zyon-widget-v2 .
#
# Design:
#   - Builder: node:20-alpine + pnpm via corepack + BuildKit cache mounts
#   - Runner:  nginx:1.27-alpine (~40 MB base) — static files only
#   - SPA routing: try_files fallback to /index.html (so React Router works)
#   - Healthcheck: HEAD / to detect dead containers
#   - Non-root: nginx-unprivileged image variant for K8s/Railway without root
#   - OCI labels: vendor, version, source

# =============================================================================
# Stage 1 — builder
# =============================================================================
FROM node:20-alpine AS builder

ENV PNPM_HOME=/pnpm \
    PNPM_VERSION=9.15.0 \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# Workspace manifests first (cache hit when only sources change).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Package manifests — only what the widget needs.
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/contracts/package.json    packages/contracts/package.json
COPY apps/widget_v2/package.json        apps/widget_v2/package.json

# Full source.
COPY packages/shared-types/ packages/shared-types/
COPY packages/contracts/    packages/contracts/
COPY apps/widget_v2/        apps/widget_v2/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=nm,target=/repo/node_modules \
    pnpm install --frozen-lockfile --prefer-offline

# Build chain (deps → widget bundle).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @zyon/shared-types build \
 && pnpm --filter @zyon/contracts build \
 && pnpm --filter @zyon/widget-v2 build

# =============================================================================
# Stage 2 — runner (nginx-unprivileged, ~40 MB)
# =============================================================================
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

LABEL org.opencontainers.image.title="zyon-widget-v2" \
      org.opencontainers.image.description="AACP checkout widget (React SPA)" \
      org.opencontainers.image.source="https://github.com/costaadiego1989/zyon" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="Zyon"

# nginx-unprivileged listens on 8080 by default; align with Railway expectation.
# Override default config with our SPA-aware one.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/widget_v2/nginx.conf /etc/nginx/conf.d/default.conf

# nginx-unprivileged runs as uid 101; chown built assets so nginx can serve them.
COPY --from=builder --chown=nginx:nginx /repo/apps/widget_v2/dist /usr/share/nginx/html

# Drop back to non-root (101:101) for runtime — least-privilege.
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# nginx-unprivileged entrypoint already runs nginx in foreground.
CMD ["nginx", "-g", "daemon off;"]
