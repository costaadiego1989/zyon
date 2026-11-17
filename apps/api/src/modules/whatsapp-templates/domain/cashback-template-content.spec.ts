import test from "node:test";
import assert from "node:assert/strict";
import { WHATSAPP_TEMPLATE_TYPES } from "./catalog/template-types.js";
import { prepareSalesWhatsApp, salesDefaults } from "./sales-template-content.js";

test("CASH template factory prepares every legacy and new catalog default",()=>{
  assert.equal(WHATSAPP_TEMPLATE_TYPES.length,30);
  for(const type of WHATSAPP_TEMPLATE_TYPES){
    const prepared=prepareSalesWhatsApp(type,salesDefaults(type).whatsapp.body);
    assert.ok(prepared.metaBody.trim(),type);
    assert.doesNotMatch(prepared.metaBody,/\{\{[A-Za-z_]/,type);
    assert.ok(Object.values(prepared.sampleVariables).every(value=>value.trim()),type);
  }
  const available=prepareSalesWhatsApp("cashback_available",salesDefaults("cashback_available").whatsapp.body);
  assert.equal(available.category,"MARKETING");
  assert.deepEqual(Object.values(available.variableMap),["buyerName","cashbackAmount","storeName"]);
  const expiring=prepareSalesWhatsApp("cashback_expiring",salesDefaults("cashback_expiring").whatsapp.body);
  assert.equal(expiring.category,"MARKETING");
  assert.deepEqual(Object.values(expiring.variableMap),["buyerName","cashbackAmount","storeName","cashbackExpiresAt"]);
});

test("CASH exact type-specific variables cannot expand operational or arbitrary template variables",()=>{
  assert.throws(()=>prepareSalesWhatsApp("order_confirmation","Aviso {{cashbackAmount}}"),/unsupported_template_variable/);
  assert.throws(()=>prepareSalesWhatsApp("marketplace_operational_alert","Aviso {{cashbackExpiresAt}}"),/unsupported_template_variable/);
  assert.throws(()=>prepareSalesWhatsApp("cashback_available","Aviso {{cashbackExpiresAt}}"),/unsupported_template_variable/);
  for(const name of ["customerEmail","cashbackBalance","constructor","__proto__"]){
    assert.throws(()=>prepareSalesWhatsApp("cashback_available",`Aviso {{${name}}}`),/unsupported_template_variable/);
  }
});
