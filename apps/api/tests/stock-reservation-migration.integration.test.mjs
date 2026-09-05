import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
test("stock reservation migration backfills only unambiguous warehouses and enforces its FK", { skip: !databaseUrl }, async () => {
  const { Client } = createRequire(import.meta.url)("pg");
  const client = new Client({ connectionString: databaseUrl });
  const schema = `audit_migration_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^audit_migration_[a-f0-9]+$/);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE product_stock (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL)');
    await client.query('CREATE TABLE stock_reservations (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL)');
    await client.query("INSERT INTO product_stock VALUES ('single','v1'),('a','v2'),('b','v2')");
    await client.query("INSERT INTO stock_reservations VALUES ('r1','v1'),('r2','v2'),('r3','missing')");
    const migration = await readFile(new URL('../prisma/migrations/20260905150000_bind_stock_reservations/migration.sql', import.meta.url), 'utf8');
    await client.query(migration);
    const result = await client.query('SELECT id, stock_id FROM stock_reservations ORDER BY id');
    assert.deepEqual(result.rows, [{ id: 'r1', stock_id: 'single' }, { id: 'r2', stock_id: null }, { id: 'r3', stock_id: null }]);
    await assert.rejects(client.query("DELETE FROM product_stock WHERE id='single'"), (error) => error.code === '23503');
    await assert.rejects(client.query("UPDATE stock_reservations SET stock_id='unknown' WHERE id='r2'"), (error) => error.code === '23503');
  } finally {
    // This schema was uniquely created above, in the explicitly supplied test database.
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
