import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

// Apply only the recovered returns release. Other pending product migrations
// stay outside this deployment. Each SQL change and its Prisma history entry
// commit together; a failed migration leaves the old schema intact.
const migrations = [
  '20261003150000_conversational_returns',
  '20261004110000_recover_return_conversations',
  '20261005100000_private_support_photo_payload',
  '20261005160000_return_decision_notices',
];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("SET lock_timeout = '15s'");
  await db.query("SET statement_timeout = '60s'");
  await db.query("SELECT pg_advisory_lock(hashtext('zyon:conversational-returns:migrations'))");
  const historyExists = (await db.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present")).rows[0].present;
  if (!historyExists) throw new Error('prisma_migration_history_required');
  for (const name of migrations) {
    const history = (await db.query('SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1 ORDER BY started_at DESC LIMIT 1', [name])).rows[0];
    if (history?.finished_at) { console.log(`returns_migration_already_applied ${name}`); continue; }
    if (history && !history.rolled_back_at) throw new Error(`unresolved_migration:${name}`);
    const sql = await readFile(new URL(`../prisma/deploy-migrations/${name}/migration.sql`, import.meta.url), 'utf8');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1,$2,CURRENT_TIMESTAMP,$3,CURRENT_TIMESTAMP,1)', [randomUUID(), createHash('sha256').update(sql).digest('hex'), name]);
      await db.query('COMMIT');
      console.log(`returns_migration_applied ${name}`);
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
  const schema = (await db.query(`SELECT
    to_regclass('public.return_drafts') IS NOT NULL AS drafts,
    to_regclass('public.return_notice_deliveries') IS NOT NULL AS notices,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='support_attachments' AND column_name='encrypted_payload') AS private_photos,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='support_tickets' AND column_name='buyer_id') AS buyer_ownership,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='returns' AND column_name='order_snapshot') AS order_snapshot
  `)).rows[0];
  if (!Object.values(schema).every(Boolean)) throw new Error('conversational_returns_schema_incomplete');
  console.log(`returns_schema_verified ${JSON.stringify(schema)}`);
} finally { await db.end(); }
