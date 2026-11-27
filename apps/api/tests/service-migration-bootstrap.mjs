import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {constructionOnlyEnvironment} from './nest-construction-only.guards.mjs';
import {assertNativePrismaUrl} from './native-prisma-admission-guards.mjs';
import {installCheckoutSessionVersionTrigger} from './checkout-session-version-trigger.mjs';

export const apiRoot=fileURLToPath(new URL('../',import.meta.url));
export const migrationName='20261114000000_service_business_capability';
export const migrationPath=resolve(apiRoot,'prisma/deploy-migrations',migrationName,'migration.sql');
export const migrationMirror=resolve(apiRoot,'prisma/migrations',migrationName,'migration.sql');
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function migrationCli(db,args){
  assertNativePrismaUrl(db.prismaUrl);
  assert.equal(await db.sql('SELECT run_id FROM synthetic_native_marker'),db.runId);
  const require=createRequire(new URL('../package.json',import.meta.url)),pkg=require.resolve('prisma/package.json');
  return promisify(execFile)(process.execPath,['--import',new URL('./test-network-guard.mjs',import.meta.url).href,
    resolve(dirname(pkg),JSON.parse(readFileSync(pkg,'utf8')).bin.prisma),...args],
    {cwd:apiRoot,env:{...constructionOnlyEnvironment(process.env),DATABASE_URL:db.prismaUrl},windowsHide:true,timeout:90_000,maxBuffer:8_000_000});
}
export async function bootstrapPriorServiceSchema(db){
  const provenance=JSON.parse(readFileSync(resolve(apiRoot,'tests/fixtures/service-business/baseline-provenance.json'),'utf8'));
  assert.equal(provenance.version,1);
  assert.equal(provenance.kind,'identified-prisma-baseline-not-historical-replay');
  assert.equal(provenance.sourceRevision,'432d147a3c24001c4bb02aff4706e7dd7dd5f59a','service_fixture_live_baseline_revision_changed');
  const canonical=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  const schema=readFileSync(resolve(apiRoot,'tests/fixtures/service-business/schema-before-services.prisma'));
  assert.equal(sha(canonical(schema)),provenance.canonicalSchemaSha256,'service_fixture_live_baseline_schema_changed');
  const baseline=provenance.baselineMigrations,execute=provenance.executeMigrations;
  assert.equal(baseline.length,47);assert.equal(new Set(baseline.map(row=>row.id)).size,47);
  assert.deepEqual(execute,['20261114000000_service_business_capability','20261116000000_support_notification_settings',
    '20261118000000_service_appointment_original_lease','20261118010000_service_reschedule_receipt','20261118020000_service_order_authority']);
  assert.ok(baseline.every(row=>!execute.includes(row.id)),'service_fixture_must_not_resolve_service_migration');
  const migrationRoot=resolve(apiRoot,'prisma/deploy-migrations');
  const managed=readdirSync(migrationRoot,{withFileTypes:true}).filter(row=>row.isDirectory()).map(row=>row.name).sort();
  assert.deepEqual(managed,[...baseline.map(row=>row.id),...execute].sort(),'service_fixture_unreviewed_managed_migration');
  // The complete deployed schema is represented by an identified Prisma
  // snapshot; these are explicit already-incorporated IDs, never a date fence.
  // SQL checksums remain the exact current bytes, including the reviewed
  // environment-specific historical LF/CRLF materialization.
  const rows=baseline.map(row=>{
    assert.match(row.id,/^[a-zA-Z0-9_]+$/);assert.match(row.canonicalSha256,/^[a-f0-9]{64}$/);
    const bytes=readFileSync(resolve(migrationRoot,row.id,'migration.sql'));
    assert.equal(sha(canonical(bytes)),row.canonicalSha256,'service_fixture_baseline_migration_changed:'+row.id);
    return `('${randomUUID()}','${sha(bytes)}',now(),'${row.id}',1)`;
  });
  const ddl=await migrationCli(db,['migrate','diff','--from-empty','--to-schema-datamodel','tests/fixtures/service-business/schema-before-services.prisma','--script']);
  await db.sql(ddl.stdout);
  await installCheckoutSessionVersionTrigger(db);
  // Exactly five SERVICE migrations are absent from this fixture ledger and
  // remain pending so the original migrate deploy executes their real SQL.
  await db.sql(`CREATE TABLE "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at TIMESTAMPTZ,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),applied_steps_count INTEGER NOT NULL DEFAULT 0);
    INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,applied_steps_count) VALUES ${rows.join(',')};`);
}
export async function assertServiceSchema(db){
  const delta=await migrationCli(db,['migrate','diff','--from-url',db.prismaUrl,'--to-schema-datamodel','prisma/schema.prisma','--script']);
  const statements=delta.stdout.split(/\r?\n/).filter(line=>!line.trim().startsWith('--')).join('\n').trim();
  // The ownership marker is the only deliberate unmanaged fixture table. Its
  // UUID has just been verified; no business-table difference is ignored.
  assert.equal(statements,'DROP TABLE "synthetic_native_marker";','service_managed_schema_drift:'+statements.slice(0,1200));
  const receipt=await db.sql(`SELECT checksum FROM _prisma_migrations WHERE migration_name='${migrationName}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;`);
  assert.equal(receipt,sha(readFileSync(migrationPath)),'service_migration_receipt_mismatch');
}
export async function deployServiceSchema(db){
  await migrationCli(db,['migrate','deploy']);
  await assertServiceSchema(db);
}
export async function bootstrapServiceSchema(db){
  await bootstrapPriorServiceSchema(db);
  await deployServiceSchema(db);
}
