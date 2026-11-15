import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { initialStore } from "../domain/types.js";
import { testDatabase } from "./__tests__/database.js";

test("MGA-76 store deletion cascades module data and idempotency stays tenant scoped", async () => {
  const db = await testDatabase();
  try {
    for (const id of ["store-a", "store-b"]) {
      await db.sql.query("INSERT INTO meta_ads_agent_stores(merchant_id,state,updated_at) VALUES($1,$2,now())", [id, initialStore(id)]);
      await db.sql.query("INSERT INTO meta_ads_agent_records(id,merchant_id,key,kind,payload) VALUES($1,$2,'same-event','audit','{}')", [id, id]);
    }
    await assert.rejects(db.sql.query("INSERT INTO meta_ads_agent_records(id,merchant_id,key,kind,payload) VALUES('duplicate','store-a','same-event','audit','{}')"), { code: "23505" });
    await assert.rejects(db.sql.query("INSERT INTO meta_ads_agent_stores(merchant_id,state,updated_at) VALUES('absent','{}',now())"));
    await db.sql.query("DELETE FROM merchants WHERE id='store-a'");
    assert.deepEqual((await db.sql.query("SELECT merchant_id FROM meta_ads_agent_stores")).rows, [{ merchant_id: "store-b" }]);
    assert.deepEqual((await db.sql.query("SELECT merchant_id FROM meta_ads_agent_records")).rows, [{ merchant_id: "store-b" }]);
    const [reference, deployment] = await Promise.all([
      readFile(new URL("../../../../prisma/migrations/20261114180000_meta_ads_agent/migration.sql", import.meta.url), "utf8"),
      readFile(new URL("../../../../prisma/deploy-migrations/20261114180000_meta_ads_agent/migration.sql", import.meta.url), "utf8"),
    ]);
    assert.equal(reference, deployment);
  } finally { await db.close(); }
});
