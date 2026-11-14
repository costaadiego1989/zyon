import assert from 'node:assert/strict';
import {bootstrapPriorServiceSchema} from './service-migration-bootstrap.mjs';
export {apiRoot,migrationName,migrationPath,migrationMirror,migrationCli,sha} from './service-migration-bootstrap.mjs';
export function insert(table,row){
  assert.match(table,/^[a-z_]+$/);
  const value=v=>v===null?'NULL':typeof v==='boolean'?String(v):typeof v==='number'?(assert.ok(Number.isFinite(v)),String(v))
    :typeof v==='object'?`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`:`'${String(v).replaceAll("'","''")}'`;
  for(const key of Object.keys(row))assert.match(key,/^[a-z_]+$/);
  return `INSERT INTO "${table}" (${Object.keys(row).map(k=>`"${k}"`).join(',')}) VALUES (${Object.values(row).map(value).join(',')});`;
}
export const at='2030-01-01T00:00:00Z';
export function appointment(id,extra={}){
  return{id,merchant_id:'fixture-services',professional_id:'fixture-professional',product_id:'fixture-service',variant_id:'fixture-variant',
    customer_snapshot:{name:'Synthetic buyer'},starts_at:'2030-01-02T10:00:00Z',ends_at:'2030-01-02T10:30:00Z',time_zone:'UTC',
    duration_minutes:30,price_in_cents:5000,currency:'BRL',policy_version:1,policy_snapshot:{holdEnabled:false,paymentMode:'online'},
    origin:'manual',idempotency_key:id,request_fingerprint:id,updated_at:at,...extra};
}
export async function seedPriorFixture(db){
  await bootstrapPriorServiceSchema(db);
  const rows=[];
  for(const id of ['base-products','base-legacy-service','base-mixed','base-other'])rows.push(insert('merchants',{id,name:`Synthetic ${id}`,updated_at:at}));
  for(const [id,merchant_id,type]of [['base-physical','base-products','physical'],['base-service','base-legacy-service','service'],
    ['base-mixed-physical','base-mixed','physical'],['base-mixed-service','base-mixed','service'],['base-other-physical','base-other','physical']]){
    rows.push(insert('products',{id,merchant_id,name:id,type,updated_at:at}));
    rows.push(insert('product_variants',{id:`${id}-variant`,product_id:id,sku:id,updated_at:at}));
    rows.push(insert('product_prices',{id:`${id}-price`,variant_id:`${id}-variant`,base_price_in_cents:1000,updated_at:at}));
  }
  rows.push(insert('buyer_identities',{id:'base-buyer',merchant_id:'base-products',identity_key:'synthetic-phone',global_user_id:'base-buyer-global'}));
  rows.push(insert('storefront_carts',{id:'base-cart',merchant_id:'base-products',session_id:'base-cart-ref',items:[{sku:'base-physical',quantity:2,unitPriceCents:1000}],
    total:2000,updated_at:at,expires_at:'2031-01-01T00:00:00Z'}));
  rows.push(insert('product_stock',{id:'base-stock',variant_id:'base-physical-variant',quantity:7,reserved:2,updated_at:at}));
  for(const [merchant_id,suffix]of [['base-products','physical'],['base-legacy-service','service']]){
    rows.push(insert('checkout_sessions',{id:`base-checkout-${suffix}`,merchant_id,session_id:`base-session-${suffix}`,global_user_id:'base-buyer-global',
      conversation_id:`base-conversation-${suffix}`,cart:{currency:'BRL',total:25.99,items:[{sku:`base-${suffix}`,quantity:2,price:10}]},
      customer:{fullName:'Synthetic buyer'},created_at:at,updated_at:at}));
    rows.push(insert('payment_intents',{id:`base-payment-${suffix}`,merchant_id,session_id:`base-session-${suffix}`,idempotency_key:`base-payment-${suffix}`,
      amount_cents:2599,approved_amount_cents:2599,currency:'BRL',method:'pix',status:'approved',provider_payment_id:`synthetic-base-${suffix}`,updated_at:at}));
    rows.push(insert('completed_orders',{id:`base-order-${suffix}`,merchant_id,session_id:`base-session-${suffix}`,external_order_id:`synthetic-base-${suffix}`,
      order_total:25.99,currency:'BRL',shipping_cents:500,completed_at:at,fulfillment_json:{status:'scheduled',synthetic:true}}));
  }
  rows.push(insert('service_reservations',{id:'base-reservation',merchant_id:'base-legacy-service',order_id:'base-order-service',unit_id:'base-unit',
    resource_id:'base-service-variant',starts_at:'2026-01-01T10:00:00Z',ends_at:'2026-01-01T10:30:00Z',status:'reserved'}));
  await db.sql(rows.join('\n'));
}
export async function baselineSnapshot(db){
  const tables=['merchants','buyer_identities','storefront_carts','checkout_sessions','payment_intents','completed_orders','product_stock','products','product_variants','product_prices','service_reservations'];
  const pairs=tables.map(table=>`'${table}',(SELECT coalesce(jsonb_agg((to_jsonb(r)-'business_mode'-'business_mode_selected_at'-'business_mode_needs_review'-'appointment_id'-'classification_pending') ORDER BY id),'[]') FROM "${table}" r WHERE id LIKE 'base-%')`);
  return JSON.parse(await db.sql(`SELECT jsonb_build_object(${pairs.join(',')});`));
}
