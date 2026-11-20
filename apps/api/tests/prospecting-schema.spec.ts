import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createProspectingDatabase } from "./prospecting-fixture.js";

const crmMigration = new URL("../prisma/migrations/20261117190000_platform_prospecting/migration.sql", import.meta.url);
async function crmDatabase() {
  const db = await createProspectingDatabase();
  try {
    await db.pg.query("CREATE TABLE platform_operators(id text PRIMARY KEY)");
    await db.pg.query(readFileSync(crmMigration, "utf8"));
    await db.pg.query("INSERT INTO platform_operators VALUES ('operator')");
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function seedCrm(db: Awaited<ReturnType<typeof crmDatabase>>) {
  await db.pg.query(`INSERT INTO platform_prospects(id,cnpj,source_snapshot_id,assigned_operator_id,tags) VALUES ('prospect','00123456000191','snapshot-old','operator',ARRAY['qualified']);
    INSERT INTO platform_prospect_sender_bindings(id,app_id,waba_id,phone_number_id,display_phone_number,encrypted_credentials,granted_assets,connected_by) VALUES ('sender','app','waba','phone','synthetic','ciphertext','{}','operator');
    INSERT INTO prospect_endpoints(id,channel,normalized_value,protected_lookup,sender_binding_id) VALUES ('endpoint','whatsapp','synthetic-local','hmac-only','sender');
    INSERT INTO prospect_contact_bindings(prospect_id,endpoint_id) VALUES ('prospect','endpoint');
    INSERT INTO prospect_sequences(id,sender_binding_id,endpoint_id) VALUES ('sequence','sender','endpoint');
    INSERT INTO prospect_campaigns(id,name,message,send_window,created_by,daily_recipient_limit,budget_cents) VALUES ('campaign','Local fixture','controlled','{}','operator',10,1000);
    INSERT INTO campaign_recipients(id,campaign_id,prospect_id,endpoint_id,sequence_key,frozen_snapshot) VALUES ('recipient','campaign','prospect','endpoint','sender:endpoint','{"snapshotId":"snapshot-old"}');`);
}

test("PROS-05 AC4 CRM migration keeps commercial identity and protected suppression independent of snapshots", async () => {
  const db = await crmDatabase();
  try {
    await seedCrm(db);
    await db.pg.query(`INSERT INTO prospect_conversations(id,endpoint_id,prospect_id,assigned_operator_id,last_inbound_preview) VALUES ('conversation','endpoint','prospect','operator','real reply');
      INSERT INTO prospect_messages(id,conversation_id,sender_binding_id,sequence,author_type,direction,content,state) VALUES ('message','conversation','sender',1,'prospect','inbound','persisted reply','received');
      INSERT INTO contact_suppressions(id,sender_scope,protected_lookup,key_version,reason) VALUES ('suppression','zyon_platform','hmac-only',1,'opt_out');
      UPDATE platform_prospects SET source_snapshot_id='snapshot-new' WHERE id='prospect';`);
    await assert.rejects(() => db.pg.query("INSERT INTO platform_prospects(id,cnpj,source_snapshot_id) VALUES ('duplicate','00123456000191','snapshot-new')"), { code: "23505" });
    assert.deepEqual((await db.pg.query("SELECT cnpj,source_snapshot_id,assigned_operator_id,tags FROM platform_prospects")).rows, [{ cnpj: "00123456000191", source_snapshot_id: "snapshot-new", assigned_operator_id: "operator", tags: ["qualified"] }]);
    assert.deepEqual((await db.pg.query("SELECT content,author_type,direction,state FROM prospect_messages")).rows, [{ content: "persisted reply", author_type: "prospect", direction: "inbound", state: "received" }]);
    assert.deepEqual((await db.pg.query("SELECT sender_scope,protected_lookup,key_version,reason FROM contact_suppressions")).rows, [{ sender_scope: "zyon_platform", protected_lookup: "hmac-only", key_version: 1, reason: "opt_out" }]);
    await assert.rejects(() => db.pg.query("INSERT INTO contact_suppressions(id,sender_scope,protected_lookup,key_version,reason) VALUES ('duplicate','zyon_platform','hmac-only',1,'repeat')"), { code: "23505" });
    await assert.rejects(() => db.pg.query("INSERT INTO prospect_conversations(id,endpoint_id,assigned_operator_id) VALUES ('bad','missing','operator')"), { code: "23503" });
  } finally { await db.close(); }
});

test("PROS-14 AC1 CRM constraints permit one ordinal reservation and rollback duplicate budget/outbox changes", async () => {
  const db = await crmDatabase();
  try {
    await seedCrm(db);
    async function reserve(id: string) {
      const client = await db.pg.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE prospect_campaigns SET reserved_cents=reserved_cents+100 WHERE id='campaign'");
        await client.query("INSERT INTO outreach_attempts(id,sequence_id,recipient_id,ordinal,client_request_id,request_hash,state,lease_token,sender_version,reserved_amount) VALUES ($1,'sequence','recipient',0,$1,'hash','reserved',$1,1,100)", [id]);
        await client.query("INSERT INTO prospect_outbox(id,event_id,kind,payload) VALUES ($1,$1,'send','{}')", [id]);
        await client.query("COMMIT"); return true;
      } catch (error) { await client.query("ROLLBACK"); if ((error as { code: string }).code !== "23505") throw error; return false; }
      finally { client.release(); }
    }
    assert.deepEqual((await Promise.all([reserve("worker-a"), reserve("worker-b")])).sort(), [false, true]);
    assert.equal((await db.pg.query("SELECT reserved_cents FROM prospect_campaigns WHERE id='campaign'")).rows[0].reserved_cents, "100");
    assert.equal((await db.pg.query("SELECT count(*)::int AS count FROM outreach_attempts")).rows[0].count, 1);
    assert.equal((await db.pg.query("SELECT count(*)::int AS count FROM prospect_outbox")).rows[0].count, 1);
    await assert.rejects(() => db.pg.query("INSERT INTO outreach_attempts(id,sequence_id,ordinal,client_request_id,request_hash,sender_version) VALUES ('third','sequence',2,'third','hash',1)"), { code: "23514" });
    await assert.rejects(() => db.pg.query("UPDATE prospect_sequences SET follow_up_count=2 WHERE id='sequence'"), { code: "23514" });
    await assert.rejects(() => db.pg.query("UPDATE prospect_campaigns SET reserved_cents=-1 WHERE id='campaign'"), { code: "23514" });
    await db.pg.query("UPDATE outreach_attempts SET state='outcome_unknown' WHERE sequence_id='sequence'");
    const connection = await db.pg.connect();
    try { assert.deepEqual((await connection.query("SELECT state,reserved_amount,provider_message_id FROM outreach_attempts")).rows, [{ state: "outcome_unknown", reserved_amount: "100", provider_message_id: null }]); } finally { connection.release(); }
  } finally { await db.close(); }
});
