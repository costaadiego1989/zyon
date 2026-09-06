import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
test("security migrations preserve ownership, disable ambiguous accounts, and enforce inbox constraints", { skip: !databaseUrl }, async () => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && target.pathname === "/ready_prod_test");
  const { Client } = createRequire(import.meta.url)("pg");
  const client = new Client({ connectionString: databaseUrl });
  const schema = `audit_security_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^audit_security_[a-f0-9]+$/);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');
      CREATE TABLE merchant_users (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, role TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());
      CREATE TABLE merchant_team_members (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, user_id TEXT NOT NULL,
        role "MerchantRole" NOT NULL, joined_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE(merchant_id,user_id));
      INSERT INTO merchant_users(id,merchant_id,role) VALUES
        ('owner','a','owner'), ('removed','a','ADMIN'), ('staff','a','ADMIN'), ('unknown','a','other'), ('cross','a','STAFF');
      INSERT INTO merchant_team_members(id,merchant_id,user_id,role) VALUES ('active','a','staff','STAFF'), ('wrong-tenant','b','cross','ADMIN');`);
    const auth = await readFile(new URL("../prisma/migrations/20260905180000_durable_merchant_auth/migration.sql", import.meta.url), "utf8");
    const inbox = await readFile(new URL("../prisma/migrations/20260905230000_whatsapp_webhook_inbox/migration.sql", import.meta.url), "utf8");
    await client.query(auth);
    await client.query(inbox);
    const rows = (await client.query("SELECT id,role,auth_version,disabled_at IS NOT NULL AS disabled FROM merchant_users ORDER BY id")).rows;
    assert.deepEqual(rows, [
      { id: "cross", role: "staff", auth_version: 0, disabled: true },
      { id: "owner", role: "owner", auth_version: 0, disabled: false },
      { id: "removed", role: "admin", auth_version: 0, disabled: true },
      { id: "staff", role: "staff", auth_version: 0, disabled: false },
      { id: "unknown", role: "other", auth_version: 0, disabled: true },
    ]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM merchant_team_members WHERE merchant_id='a' AND user_id='owner'")).rows[0].n, 1);
    await assert.rejects(client.query("INSERT INTO merchant_auth_sessions(id,family_id,user_id,merchant_id,auth_version,refresh_expires_at) VALUES ('s','f','absent','a',0,NOW())"), (error) => error.code === "23503");
    const insert = "INSERT INTO whatsapp_webhook_inbox(id,dedup_key,event_id,kind,merchant_id,config_id,device_id,stream_key,payload,payload_hash) VALUES ($1,'dedup','event',$2,'a','config','device','stream','{}','hash')";
    await assert.rejects(client.query(insert, ["bad", "unknown"]), (error) => error.code === "23514");
    await client.query(insert, ["good", "message"]);
    await assert.rejects(client.query(insert, ["duplicate", "message"]), (error) => error.code === "23505");
    await assert.rejects(client.query("UPDATE whatsapp_webhook_inbox SET status='invalid'"), (error) => error.code === "23514");
    await assert.rejects(client.query("UPDATE whatsapp_webhook_inbox SET attempts=-1"), (error) => error.code === "23514");
  } finally {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
