import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeMigrationDecision, asaasMigrationDecision } from './billing-price-migration-policy.mjs';
const subscription = () => ({status:'active',items:{data:[{id:'si_1',quantity:1,price:{id:'old',currency:'brl',recurring:{interval:'month',interval_count:1}}}]}});
test('Stripe replaces the item without prorations or a new billing date',()=>{
 const result=stripeMigrationDecision(subscription(),['old'],'new');
 assert.deepEqual(result.patch,{items:[{id:'si_1',price:'new',quantity:1}],proration_behavior:'none',billing_cycle_anchor:'unchanged'});
});
test('Stripe special terms, lifecycle changes and already migrated prices are skipped',()=>{
 for(const patch of [{status:'past_due'},{cancel_at_period_end:true},{schedule:'sched_1'},{discounts:['di_1']},{pending_update:{}}])assert(stripeMigrationDecision({...subscription(),...patch},['old'],'new').skip);
 assert.equal(stripeMigrationDecision(subscription(),['other'],'new').skip,'unrecognized_price');
 assert.equal(stripeMigrationDecision(subscription(),['other'],'old').skip,'already_current');
});
test('Asaas requires DB ownership/plan agreement and preserves issued pending invoices',()=>{
 const sub={id:'sub_1',status:'ACTIVE',value:249,cycle:'MONTHLY'},db={provider:'asaas',status:'active',planKey:'growth',asaasSubscriptionId:'sub_1'};
 assert.deepEqual(asaasMigrationDecision(sub,db,349).patch,{value:349,updatePendingPayments:false});
 assert.equal(asaasMigrationDecision(sub,{...db,planKey:'scale'},349).skip,'database_mismatch');
 assert.equal(asaasMigrationDecision({...sub,value:349},db,349).skip,'already_current');
 assert.equal(asaasMigrationDecision({...sub,value:199},db,349).skip,'nonstandard_terms');
 assert.equal(asaasMigrationDecision(sub,{...db,pendingPlanKey:'scale'},349).skip,'pending_lifecycle_change');
});
