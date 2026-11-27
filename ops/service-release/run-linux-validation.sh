#!/bin/sh
set -eu
MODE=${1:-full}
case "$MODE" in full|--bootstrap-only) ;; *) echo "unsupported bootstrap mode" >&2; exit 2 ;; esac
test "$(uname -m)" = x86_64
test -n "${SERVICE_RELEASE_NODE_BASE_IMAGE:-}"
test -n "${SERVICE_RELEASE_NGINX_BASE_IMAGE:-}"
test -n "${SERVICE_RELEASE_TARGET:-}"
test -f .cache/service-release-public-auth.json
test ! -e .env
test ! -e apps/api/.env
test ! -e apps/api/prisma/.env
git config --global --add safe.directory /repo
node scripts/service-release-migration-bytes.mjs "$SERVICE_RELEASE_TARGET"
node scripts/service-release-support-migration-bytes.mjs "$SERVICE_RELEASE_TARGET"
pnpm install --prod=false --frozen-lockfile
pnpm --dir apps/dashboard exec playwright install --with-deps msedge
docker pull postgres:16-alpine
docker pull pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a
docker tag pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a pgvector/pgvector:pg16
node --input-type=module -e "import {execFileSync} from 'node:child_process'; import {assertCachedPgvectorImage} from './apps/api/tests/local-postgres-profiles.mjs'; assertCachedPgvectorImage(JSON.parse(execFileSync('docker',['image','inspect','pgvector/pgvector:pg16'],{encoding:'utf8'}))[0]);"
docker pull redis:7-alpine
docker pull neo4j:5.26-community
if [ "$MODE" = "--bootstrap-only" ]; then exit 0; fi
node scripts/service-linux-release.mjs .cache/service-release-public-auth.json
node scripts/service-linux-export-prebuilt.mjs "$SERVICE_RELEASE_NODE_BASE_IMAGE" "$SERVICE_RELEASE_NGINX_BASE_IMAGE" "$SERVICE_RELEASE_TARGET"
