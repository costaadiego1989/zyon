import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createDisposablePostgres} from './local-disposable-postgres.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';
import {migrationName,migrationPath,migrationMirror,migrationCli,seedPriorFixture,baselineSnapshot,insert,appointment,at,sha} from './service-migration-fixture.mjs';
import {assertServiceSchema} from './service-migration-bootstrap.mjs';

test('T5',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const sql=readFileSync(migrationPath);
  await t.test('active deployment SQL and preserved-history mirror are byte-identical',()=>assert.deepEqual(readFileSync(migrationMirror),sql));
  const db=await createDisposablePostgres({transport:'loopback-exec'});
  try{
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await seedPriorFixture(db);
    const before=await baselineSnapshot(db);
    await t.test('real deploy preserves legacy commerce and leaves ambiguous services explicit',async()=>{
      await migrationCli(db,['migrate','deploy']);
      assert.deepEqual(await baselineSnapshot(db,{serviceOriginColumns:true}),before);
      const modes=JSON.parse(await db.sql(`SELECT jsonb_object_agg(id,jsonb_build_array(business_mode,business_mode_needs_review,business_mode_selected_at)) FROM merchants WHERE id LIKE 'base-%';`));
      assert.deepEqual(modes,{'base-products':['products',false,null],'base-legacy-service':['products',true,null],
        'base-mixed':['products',true,null],'base-other':['products',false,null]});
      assert.equal(await db.sql('SELECT count(*) FROM service_professionals'), '0');
      assert.equal(await db.sql('SELECT count(*) FROM service_appointments'), '0');
      assert.equal(await db.sql('SELECT count(*) FROM service_business_policies'), '0');
      assert.equal(await db.sql("SELECT classification_pending AND appointment_id IS NULL FROM service_reservations WHERE id='base-reservation'"),'t');
    });
    await t.test('official migration ledger makes redeployment a no-op',async()=>{
      const ledger=await db.sql(`SELECT checksum||':'||applied_steps_count::text FROM _prisma_migrations WHERE migration_name='${migrationName}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;`);
      assert.equal(ledger,`${sha(sql)}:1`);
      await migrationCli(db,['migrate','deploy']);
      assert.equal(await db.sql(`SELECT count(*) FROM _prisma_migrations WHERE migration_name='${migrationName}'`),'1');
      assert.deepEqual(await baselineSnapshot(db,{serviceOriginColumns:true}),before);
    });
    await t.test('runtime schema parity rejects an unrelated database change',async()=>{
      await assertServiceSchema(db);
      await db.sql('ALTER TABLE products ADD COLUMN fixture_unmanaged TEXT;');
      await assert.rejects(assertServiceSchema(db),/service_managed_schema_drift/);
      await db.sql('ALTER TABLE products DROP COLUMN fixture_unmanaged;');
      await assertServiceSchema(db);
    });
    await db.sql(insert('merchants',{id:'fixture-services',name:'Synthetic service fixture',business_mode:'services',business_mode_selected_at:at,updated_at:at})+
      insert('products',{id:'fixture-service',merchant_id:'fixture-services',name:'Synthetic service',type:'service',updated_at:at})+
      insert('product_variants',{id:'fixture-variant',product_id:'fixture-service',sku:'SYNTHETIC-SERVICE',updated_at:at})+
      insert('service_professionals',{id:'fixture-professional',merchant_id:'fixture-services',public_name:'Synthetic professional',time_zone:'UTC',updated_at:at})+
      insert('professional_services',{id:'fixture-link',merchant_id:'fixture-services',professional_id:'fixture-professional',product_id:'fixture-service',updated_at:at}));
    await t.test('unconfigured policy cannot admit and an enabled hold needs positive duration',async()=>{
      await db.sql(insert('service_business_policies',{merchant_id:'fixture-services',updated_at:at}));
      assert.equal(await db.sql("SELECT NOT admissions_enabled AND hold_enabled IS NULL AND payment_mode IS NULL AND configured_at IS NULL FROM service_business_policies WHERE merchant_id='fixture-services'"),'t');
      await assert.rejects(db.sql("UPDATE service_business_policies SET admissions_enabled=true WHERE merchant_id='fixture-services'"),/check constraint/i);
      await assert.rejects(db.sql("UPDATE service_business_policies SET hold_enabled=true,hold_minutes=0,payment_mode='online',configured_at=now(),version=1 WHERE merchant_id='fixture-services'"),/check constraint/i);
    });
    await t.test('one canonical intent can fund several units but not duplicate an allocation',async()=>{
      await db.sql(insert('service_appointments',appointment('fixture-appointment-one'))+
        insert('service_appointments',appointment('fixture-appointment-two',{starts_at:'2030-01-02T11:00:00Z',ends_at:'2030-01-02T11:30:00Z'}))+
        insert('payment_intents',{id:'fixture-shared-intent',merchant_id:'fixture-services',session_id:'fixture-session',idempotency_key:'fixture-shared-intent',
          amount_cents:10000,currency:'BRL',method:'pix',status:'pending',updated_at:at}));
      const allocation=(id,appointment_id)=>({id,merchant_id:'fixture-services',appointment_id,mode:'online',amount_cents:5000,currency:'BRL',
        payment_intent_id:'fixture-shared-intent',provider:'synthetic-only',provider_payment_id:'fixture-shared-provider',idempotency_key:id,request_fingerprint:id,updated_at:at});
      await db.sql(insert('appointment_payments',allocation('fixture-allocation-one','fixture-appointment-one'))+
        insert('appointment_payments',allocation('fixture-allocation-two','fixture-appointment-two')));
      assert.equal(await db.sql("SELECT count(*)||':'||sum(amount_cents)::text FROM appointment_payments WHERE payment_intent_id='fixture-shared-intent'"),'2:10000');
      assert.equal(await db.sql("SELECT status FROM payment_intents WHERE id='fixture-shared-intent'"),'pending','This fixture does not assert PSP approval.');
      await assert.rejects(db.sql(insert('appointment_payments',allocation('fixture-allocation-duplicate','fixture-appointment-one'))),/unique constraint/i);
    });
    await t.test('foreign product and variant references fail and roll back prior writes',async()=>{
      await assert.rejects(db.sql('BEGIN;'+insert('service_professionals',{id:'fixture-rollback-prof',merchant_id:'fixture-services',public_name:'Synthetic rollback',time_zone:'UTC',updated_at:at})+
        insert('professional_services',{id:'fixture-foreign-link',merchant_id:'fixture-services',professional_id:'fixture-rollback-prof',product_id:'base-other-physical',updated_at:at})+'COMMIT;'),/foreign key constraint/i);
      assert.equal(await db.sql("SELECT count(*) FROM service_professionals WHERE id='fixture-rollback-prof'"),'0');
      await assert.rejects(db.sql(insert('service_appointments',appointment('fixture-foreign-variant',{variant_id:'base-other-physical-variant'}))),/foreign key constraint/i);
      assert.deepEqual(await baselineSnapshot(db,{serviceOriginColumns:true}),before);
    });
    await t.test('confirmed intervals reject overlap while adjacent intervals remain available',async()=>{
      const confirmed={operational_status:'scheduled',confirmed_at:at};
      await db.sql(insert('service_appointments',appointment('fixture-confirmed',{...confirmed,starts_at:'2030-01-03T10:00:00Z',ends_at:'2030-01-03T10:30:00Z'})));
      await assert.rejects(db.sql(insert('service_appointments',appointment('fixture-overlap',{...confirmed,starts_at:'2030-01-03T10:15:00Z',ends_at:'2030-01-03T10:45:00Z'}))),/exclusion constraint/i);
      await db.sql(insert('service_appointments',appointment('fixture-adjacent',{...confirmed,starts_at:'2030-01-03T10:30:00Z',ends_at:'2030-01-03T11:00:00Z'})));
      assert.equal(await db.sql("SELECT count(*) FROM service_appointments WHERE id IN ('fixture-confirmed','fixture-adjacent')"),'2');
    });
  }finally{await db.dispose();}
  assert.deepEqual(db.bridgeStatus(),{listening:false,sockets:0,children:0});
});
