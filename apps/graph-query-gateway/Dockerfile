# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graph-query-gateway/package.json apps/graph-query-gateway/
RUN pnpm install --filter @zyon/graph-query-gateway --frozen-lockfile --ignore-scripts
COPY apps/api/src/modules/graph-rag/domain/ apps/graph-query-gateway/src/domain/
COPY apps/api/src/modules/graph-rag/gateway/ apps/graph-query-gateway/src/gateway/
COPY apps/graph-query-gateway/tsconfig.docker.json apps/graph-query-gateway/tsconfig.json
RUN pnpm --filter @zyon/graph-query-gateway build
RUN pnpm --filter @zyon/graph-query-gateway deploy --prod /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/gateway/server.js"]
