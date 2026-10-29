import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
test("inventory receipt migration enforces one receipt per merchant/order while allowing tenant-local order IDs", { skip: !databaseUrl }, async () => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && target.pathname === "/ready_prod_test");
  const { Client } = createRequire(import.meta.url)("pg");
  const client = new Client({ connectionString: databaseUrl });
  const schema = `audit_inventory_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^audit_inventory_[a-f0-9]+$/);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(await readFile(new URL("../prisma/migrations/20260906012000_inventory_sale_receipts/migration.sql", import.meta.url), "utf8"));
    const insert = "INSERT INTO inventory_sale_receipts(id,merchant_id,order_id,payload_hash,payload,result) VALUES ($1,$2,'order_same','hash','{}','{}')";
    await client.query(insert, ["receipt_a", "merchant_a"]);
    await assert.rejects(client.query(insert, ["receipt_duplicate", "merchant_a"]), error => error.code === "23505");
    await client.query(insert, ["receipt_b", "merchant_b"]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM inventory_sale_receipts")).rows[0].n, 2);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
