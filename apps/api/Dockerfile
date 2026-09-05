# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the @zyon/api NestJS service.
#
# Build context: monorepo root.
#   docker build -f apps/api/Dockerfile -t zyon-api .
#
# Strategy:
#   1. Copy project (node_modules MUST be excluded by .dockerignore).
#   2. Install with devDeps (Nest CLI, ts, prisma CLI).
#   3. Generate Prisma client.
#   4. Build workspace packages (shared-types first).
#   5. Build api itself.
#   6. Runtime: same image, NODE_ENV=production.
#
# Pinned to node:22-alpine so builder and runtime match Node major.

FROM node:22-alpine

ENV PNPM_HOME=/pnpm \
    PNPM_VERSION=9.15.0 \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# ============================================================
# COPY PROJECT
# node_modules is excluded by .dockerignore (recursively).
# ============================================================
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY packages/ packages/
COPY apps/api/ apps/api/

# ============================================================
# INSTALL
# Include devDependencies because Nest CLI, TypeScript, and Prisma CLI
# are build-time requirements.
# ============================================================
RUN pnpm install --prod=false

# ============================================================
# VERIFY PRISMA INSTALL
# ============================================================
RUN echo "===== PRISMA INSTALL =====" && \
    node -e "const p=require('/repo/apps/api/node_modules/prisma/package.json'); console.log('PRISMA VERSION:', p.version)" && \
    test -f /repo/apps/api/node_modules/prisma/build/index.js && \
    echo "PRISMA CLI OK" || \
    (echo "PRISMA CLI MISSING — looking for alternatives:" && \
     find /repo -name "build" -type d 2>/dev/null | head -5 && exit 1)

RUN echo "===== PRISMA CLIENT VERSION =====" && \
    node -e "const p=require('/repo/apps/api/node_modules/@prisma/client/package.json'); console.log('CLIENT VERSION:', p.version)" && \
    node -e "\
      const cli=require('/repo/apps/api/node_modules/prisma/package.json'); \
      const client=require('/repo/apps/api/node_modules/@prisma/client/package.json'); \
      if(cli.version.split('.')[0] !== client.version.split('.')[0]) { \
        console.error('VERSION MISMATCH:', cli.version, 'vs', client.version); \
        process.exit(1); \
      }"

# ============================================================
# GENERATE PRISMA CLIENT
# prisma generate does NOT need a real DB — it only generates the client.
# Pass a dummy DATABASE_URL so prisma.config.ts validation passes during build.
# ============================================================
RUN cd /repo/apps/api && \
    DATABASE_URL="postgresql://prisma:prisma@localhost:5432/prisma?schema=public" \
    pnpm exec prisma validate --schema prisma/schema.prisma

RUN cd /repo/apps/api && \
    DATABASE_URL="postgresql://prisma:prisma@localhost:5432/prisma?schema=public" \
    pnpm exec prisma generate --schema prisma/schema.prisma

# Verify generated client exists. Prisma 6 generates inside @prisma/client package
# (under .pnpm/...), not under a separate .prisma/client directory.
RUN test -d /repo/apps/api/node_modules/@prisma/client && \
    find /repo/apps/api/node_modules/.pnpm -path "*@prisma/client*" -name "*.prisma" -type d 2>/dev/null | head -3 && \
    echo "PRISMA CLIENT GENERATED OK" || \
    (echo "PRISMA CLIENT NOT GENERATED" && \
     find /repo/apps/api/node_modules/.pnpm -name "default.d.ts" 2>/dev/null | head -5 && exit 1)

# ============================================================
# WORKSPACE BUILDS
# shared-types MUST build first — every other package depends on its dist/.
# ============================================================
RUN pnpm --filter @zyon/shared-types build
RUN pnpm --filter @zyon/contracts build
RUN pnpm --filter @zyon/commerce-adapters build
RUN pnpm --filter @zyon/conversation-engine build
RUN pnpm --filter @zyon/decision-engine build
RUN pnpm --filter @zyon/negotiation-engine build
RUN pnpm --filter @zyon/rules-engine build
RUN pnpm --filter @zyon/shipping-engine build

# ============================================================
# API
# ============================================================
RUN pnpm --filter @zyon/api build

# Verify nest build produced output.
RUN test -f /repo/apps/api/dist/main.js && \
    echo "NEST BUILD OK" || \
    (echo "NEST BUILD MISSING dist/main.js" && \
     ls /repo/apps/api/dist 2>/dev/null && exit 1)

# ============================================================
# RUNTIME
# DATABASE_URL is provided at runtime via Railway env var. Do not set here.
# ============================================================
WORKDIR /repo/apps/api

ENV NODE_ENV=production \
    PORT=3009

EXPOSE 3009

CMD ["node", "dist/main.js"]
