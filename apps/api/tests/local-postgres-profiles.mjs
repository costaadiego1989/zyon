import assert from 'node:assert/strict';

const pgvector=Object.freeze({name:'pgvector16',tag:'pgvector/pgvector:pg16',uid:999,
  imageId:'sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a',
  repoDigest:'pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a'});
const alpine=Object.freeze({name:'alpine16',tag:'postgres:16-alpine',uid:70});
export function localPostgresProfile(name){
  assert.ok(name===undefined||name==='alpine16'||name==='pgvector16','unsupported_local_postgres_profile');
  return name==='pgvector16'?pgvector:alpine;
}
export function assertCachedPgvectorImage(info){
  assert.equal(info.Id,pgvector.imageId,'cached_pgvector_image_id_mismatch');
  assert.ok(Array.isArray(info.RepoDigests)&&info.RepoDigests.includes(pgvector.repoDigest),'cached_pgvector_repo_digest_mismatch');
  assert.equal(info.Os,'linux');assert.equal(info.Architecture,'amd64');
  return pgvector.imageId;
}
export function assertPgvectorContainer(info){
  assert.equal(info.Image,pgvector.imageId,'owned_pgvector_container_image_mismatch');
  assert.equal(info.Config.User,'999:999','owned_pgvector_container_user_mismatch');
  assert.equal(info.HostConfig.Tmpfs['/var/lib/postgresql/data'],'rw,size=256m,uid=999,gid=999,mode=0700');
  assert.equal(info.HostConfig.Tmpfs['/var/run/postgresql'],'rw,size=16m,uid=999,gid=999');
}

// Static program only. No scope, SQL, path, host or port is interpolated.
// Preserve stdin on fd4: Bash background commands otherwise receive /dev/null.
// The first EOF ends the connection. This is not TCP half-close support.
export const PGVECTOR_LOOPBACK_BASH=String.raw`set -euo pipefail
reader=
writer=
cleanup() {
  trap - EXIT HUP INT TERM
  set +e
  exec 3<&- 3>&- 4<&-
  if [[ -n "$reader" ]]; then kill "$reader" 2>/dev/null; fi
  if [[ -n "$writer" ]]; then kill "$writer" 2>/dev/null; fi
  if [[ -n "$reader" ]]; then wait "$reader" 2>/dev/null; fi
  if [[ -n "$writer" ]]; then wait "$writer" 2>/dev/null; fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
exec 3<>/dev/tcp/127.0.0.1/5432
exec 4<&0
cat <&3 3<&- 4<&- &
reader=$!
cat <&4 >&3 3<&- 4<&- &
writer=$!
status=0
wait -n "$reader" "$writer" || status=$?
exit "$status"`;
export function localPostgresBridgeCommand(name){
  return localPostgresProfile(name).name==='pgvector16'
    ?['/bin/bash','-c',PGVECTOR_LOOPBACK_BASH]:['nc','127.0.0.1','5432'];
}

/** Call only after bootstrapServiceSchema's unchanged managed-schema check.
 * No migration receipt is fabricated and no error is swallowed here. */
export async function prepareOwnedPgvector(db){
  assert.equal(db.profile,'pgvector16');assert.equal(db.imageId,pgvector.imageId);assert.equal(db.repoDigest,pgvector.repoDigest);
  assert.equal(db.network,'none');assert.equal(db.transport,'loopback-exec');
  assert.match(db.runId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(await db.sql('SELECT run_id FROM synthetic_native_marker'),db.runId);
  const ledger=Number(await db.sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'));
  assert.ok(Number.isSafeInteger(ledger)&&ledger>0,'owned_pgvector_normal_migration_ledger_required');
  await db.sql(`BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(384);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_vec_idx ON public.knowledge_chunks USING hnsw (embedding_vec vector_cosine_ops) WITH (m=16,ef_construction=64);
COMMIT;`);
  const q=JSON.stringify([1,...Array(383).fill(0)]),other=JSON.stringify([0,1,...Array(382).fill(0)]);
  const result=JSON.parse(await db.sql(`SELECT json_build_object(
'extension',(SELECT extversion FROM pg_extension WHERE extname='vector'),
'columnType',(SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='public.knowledge_chunks'::regclass AND a.attname='embedding_vec' AND NOT a.attisdropped),
'dimensions',vector_dims('${q}'::vector(384)),
'sameSimilarity',1-('${q}'::vector(384) <=> '${q}'::vector(384)),
'otherSimilarity',1-('${q}'::vector(384) <=> '${other}'::vector(384)),
'indexDefinition',(SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='knowledge_chunks_embedding_vec_idx'))::text;`));
  assert.equal(result.extension,'0.8.7','cached_pgvector_extension_version_mismatch');
  assert.equal(result.columnType,'vector(384)');assert.equal(result.dimensions,384);
  assert.equal(result.sameSimilarity,1);assert.equal(result.otherSimilarity,0);
  assert.match(result.indexDefinition,/USING hnsw \(embedding_vec vector_cosine_ops\)/);
  return Object.freeze({profile:'pgvector16',imageId:db.imageId,repoDigest:db.repoDigest,...result});
}
