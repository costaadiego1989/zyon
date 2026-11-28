# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/graph-query-gateway/package.json apps/graph-query-gateway/
RUN pnpm install --filter @zyon/graph-query-gateway --frozen-lockfile --ignore-scripts
COPY ["apps/api/src/modules/graph-rag/application/public-source-work-state.ts", "apps/graph-query-gateway/src/graph-rag/application/public-source-work-state.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/graph-embedding-model.ts", "apps/graph-query-gateway/src/graph-rag/domain/graph-embedding-model.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/graph-query.ts", "apps/graph-query-gateway/src/graph-rag/domain/graph-query.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/graph-rag.port.ts", "apps/graph-query-gateway/src/graph-rag/domain/graph-rag.port.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/graph-result.ts", "apps/graph-query-gateway/src/graph-rag/domain/graph-result.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/public-business-query.ts", "apps/graph-query-gateway/src/graph-rag/domain/public-business-query.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/public-business-result.ts", "apps/graph-query-gateway/src/graph-rag/domain/public-business-result.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/public-business-source.ts", "apps/graph-query-gateway/src/graph-rag/domain/public-business-source.ts"]
COPY ["apps/api/src/modules/graph-rag/domain/public-graph-sources.port.ts", "apps/graph-query-gateway/src/graph-rag/domain/public-graph-sources.port.ts"]
COPY ["apps/api/src/modules/graph-rag/gateway/community-read-engine.ts", "apps/graph-query-gateway/src/graph-rag/gateway/community-read-engine.ts"]
COPY ["apps/api/src/modules/graph-rag/gateway/query-gateway.ts", "apps/graph-query-gateway/src/graph-rag/gateway/query-gateway.ts"]
COPY ["apps/api/src/modules/graph-rag/gateway/query-protocol.ts", "apps/graph-query-gateway/src/graph-rag/gateway/query-protocol.ts"]
COPY ["apps/api/src/modules/graph-rag/gateway/server.ts", "apps/graph-query-gateway/src/graph-rag/gateway/server.ts"]
COPY ["apps/api/src/modules/graph-rag/infrastructure/neo4j-public-row.ts", "apps/graph-query-gateway/src/graph-rag/infrastructure/neo4j-public-row.ts"]
COPY ["apps/api/src/modules/knowledge-base/domain/public-source-evidence.ts", "apps/graph-query-gateway/src/knowledge-base/domain/public-source-evidence.ts"]
COPY apps/graph-query-gateway/tsconfig.docker.json apps/graph-query-gateway/tsconfig.json
RUN pnpm --filter @zyon/graph-query-gateway build
RUN pnpm --filter @zyon/graph-query-gateway deploy --prod /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/graph-rag/gateway/server.js"]
