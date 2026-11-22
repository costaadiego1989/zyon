import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createProspectingDatabase, createProspectingLogicalDatabase } from "./prospecting-fixture.js";
import { createDirectoryPrismaClient } from "../src/modules/platform-prospecting/infrastructure/company-directory/directory-prisma-client.js";

const crmMigration = new URL("../prisma/migrations/20261117190000_platform_prospecting/migration.sql", import.meta.url);
const directoryMigration = new URL("../prisma/company-directory-migrations/20261117190100_company_directory/migration.sql", import.meta.url);
async function crmDatabase() {
  const db = await createProspectingDatabase();
  try {
    await db.pg.query("CREATE TABLE platform_operators(id text PRIMARY KEY)");
    await db.pg.query(readFileSync(crmMigration, "utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121120000_prospect_contact_identity/migration.sql", import.meta.url), "utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121130000_prospect_privacy/migration.sql", import.meta.url), "utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121140000_prospect_audience/migration.sql", import.meta.url), "utf8"));
    await db.pg.query(readFileSync(new URL("../prisma/migrations/20261121150000_prospect_reservation_day/migration.sql", import.meta.url), "utf8"));
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

test("PROS-05 AC1 directory migration preserves snapshot identities and exact CNPJ/capital with one checkpoint per batch", async () => {
  const db = await createProspectingLogicalDatabase();
  const client = createDirectoryPrismaClient({ databaseUrl: db.databaseUrl, directoryDatabaseUrl: db.databaseUrl, directoryPoolSize: 2 });
  try {
    await db.pg.query(readFileSync(directoryMigration, "utf8"));
    for (const id of ["old", "new"]) {
      await client.companySnapshot.create({ data: { id, competence: id === "old" ? "2026-10" : "2026-11", manifestHash: id, manifest: {}, sourceUrl: "https://arquivos.receitafederal.gov.br/", parserVersion: "1" } });
      await client.companyEntity.create({ data: { snapshotId: id, baseCnpj: "00ABC123", legalName: "Empresa", normalizedLegalName: "EMPRESA", capitalCents: "900719925474099312345", simples: null, mei: false } });
      await client.companyEstablishment.create({ data: { snapshotId: id, cnpj: "00ABC123000191", baseCnpj: "00ABC123", mainCnae: "6201501", uf: "SP", cityCode: "7107", status: "02" } });
    }
    await client.companySourceFile.create({ data: { id: "file", snapshotId: "new", resourceId: "establishments-0", family: "establishments", url: "https://arquivos.receitafederal.gov.br/file.zip", encoding: "ISO-8859-1", computedHash: "file-hash" } });
    await db.pg.query("INSERT INTO company_directory.company_import_checkpoints(file_id,batch_index,file_hash,row_offset,byte_offset,committed_count,batch_hash) VALUES ('file',0,'file-hash',100,500,100,'batch-hash') ON CONFLICT DO NOTHING");
    await db.pg.query("INSERT INTO company_directory.company_import_checkpoints(file_id,batch_index,file_hash,row_offset,byte_offset,committed_count,batch_hash) VALUES ('file',0,'file-hash',100,500,100,'batch-hash') ON CONFLICT DO NOTHING");
    const records = await client.companyEntity.findMany({ orderBy: { snapshotId: "asc" } });
    assert.deepEqual(records.map(row => ({ snapshotId: row.snapshotId, cnpj: row.baseCnpj, capital: row.capitalCents?.toFixed(0), simples: row.simples, mei: row.mei })), ["new", "old"].map(snapshotId => ({ snapshotId, cnpj: "00ABC123", capital: "900719925474099312345", simples: null, mei: false })));
    assert.equal(await client.companyEstablishment.count(), 2);
    assert.equal(await client.companyImportCheckpoint.count(), 1);
    const checkpoint = await client.companyImportCheckpoint.findUniqueOrThrow({ where: { fileId_batchIndex: { fileId: "file", batchIndex: 0 } } });
    assert.deepEqual({ row: checkpoint.rowOffset, byte: checkpoint.byteOffset, count: checkpoint.committedCount, fileHash: checkpoint.fileHash, batchHash: checkpoint.batchHash }, { row: 100n, byte: 500n, count: 100, fileHash: "file-hash", batchHash: "batch-hash" });
    await assert.rejects(() => db.pg.query("INSERT INTO company_directory.company_import_checkpoints(file_id,batch_index,file_hash,row_offset,byte_offset,committed_count,batch_hash) VALUES ('file',1,'different-hash',200,1000,100,'next')"), { code: "23514" });
    await assert.rejects(() => db.pg.query("INSERT INTO company_directory.company_establishments(snapshot_id,cnpj,base_cnpj) VALUES ('new','INVALID','00ABC123')"), { code: "23514" });
  } finally { await client.$disconnect(); await db.close(); }
});

test("PROS-06 AC1 directory migration supports indexed snapshot/CNAE/location predicates without merchant writes", async () => {
  const db = await createProspectingLogicalDatabase();
  const client = createDirectoryPrismaClient({ databaseUrl: db.databaseUrl, directoryDatabaseUrl: db.databaseUrl, directoryPoolSize: 2 });
  try {
    await db.pg.query("CREATE TABLE public.merchants(id text PRIMARY KEY,name text); INSERT INTO public.merchants VALUES ('real-preserved','Merchant preserved')");
    await db.pg.query(readFileSync(directoryMigration, "utf8"));
    await client.companySnapshot.create({ data: { id: "snapshot", competence: "2026-11", manifestHash: "manifest", manifest: {}, sourceUrl: "https://arquivos.receitafederal.gov.br/", parserVersion: "1" } });
    await client.companyEntity.create({ data: { snapshotId: "snapshot", baseCnpj: "00123456", legalName: "Empresa", normalizedLegalName: "EMPRESA" } });
    await client.companyEstablishment.createMany({ data: [
      { snapshotId: "snapshot", cnpj: "00123456000191", baseCnpj: "00123456", uf: "SP", cityCode: "7107", mainCnae: "6201501", status: "02" },
      { snapshotId: "snapshot", cnpj: "00123456000272", baseCnpj: "00123456", uf: "RJ", cityCode: "6001", mainCnae: "4711301", status: "02" },
    ] });
    await client.establishmentSecondaryCnae.create({ data: { snapshotId: "snapshot", cnpj: "00123456000191", cnae: "6311900" } });
    const rows = await client.companyEstablishment.findMany({ where: { snapshotId: "snapshot", uf: { in: ["SP", "MG"] }, cityCode: "7107", mainCnae: "6201501", secondaryCnaes: { some: { cnae: "6311900" } } }, orderBy: { cnpj: "asc" } });
    assert.deepEqual(rows.map(row => row.cnpj), ["00123456000191"]);
    const indexes = (await db.pg.query("SELECT indexdef FROM pg_indexes WHERE schemaname='company_directory'")).rows.map(row => row.indexdef).join("\n");
    assert.match(indexes, /snapshot_id, status, uf, city_code, cnpj/);
    assert.match(indexes, /snapshot_id, main_cnae, cnpj/); assert.match(indexes, /snapshot_id, cnae, cnpj/);
    assert.deepEqual((await db.pg.query("SELECT * FROM public.merchants")).rows, [{ id: "real-preserved", name: "Merchant preserved" }]);
    await assert.rejects(() => client.companyDirectoryActiveSnapshot.create({ data: { snapshotId: "missing" } }));
    await client.companyDirectoryActiveSnapshot.create({ data: { snapshotId: "snapshot" } });
    await assert.rejects(() => client.$transaction(async tx => {
      await tx.companyDirectoryActiveSnapshot.update({ where: { id: "national" }, data: { version: { increment: 1 } } });
      await tx.companyDirectoryActiveSnapshot.update({ where: { id: "national" }, data: { snapshotId: "missing" } });
    }));
    assert.deepEqual(await client.companyDirectoryActiveSnapshot.findUnique({ where: { id: "national" }, select: { snapshotId: true, version: true } }), { snapshotId: "snapshot", version: 1 });
    assert.throws(() => createDirectoryPrismaClient({ databaseUrl: db.databaseUrl, directoryDatabaseUrl: db.databaseUrl.replace(/\/prospecting_test_\w+$/, "/other"), directoryPoolSize: 2 }), { message: "config_invalid:directory_database_mismatch" });
  } finally { await client.$disconnect(); await db.close(); }
});
