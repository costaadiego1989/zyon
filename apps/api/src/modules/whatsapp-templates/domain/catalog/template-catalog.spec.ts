import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, categoryFor, getTemplateDefinition } from "./template-catalog.js";
import { WHATSAPP_TEMPLATE_TYPES } from "./template-types.js";

test('ACAP-19 campaign readiness defines a separate administrative template with exact scoped variables',()=>{
  const def=getTemplateDefinition('campaign_ready','Loja Aurora');assert.ok(WHATSAPP_TEMPLATE_TYPES.includes('campaign_ready'));assert.equal(def.type,'campaign_ready');assert.equal(def.category,'UTILITY');assert.equal(def.language,'pt_BR');assert.equal(def.hasCoupon,false);assert.deepEqual(def.variableMap,{'1':'campaignName','2':'campaignVersion','3':'campaignReviewLink'});assert.match(def.metaBody,/Loja Aurora/);assert.match(def.metaBody,/aprovação administrativa/);assert.doesNotMatch(def.metaBody,/cupom|desconto|pedido/iu);assert.equal(Object.hasOwn(def,'metaStatus'),false);
});
test('ACAP-19 campaign readiness examples contain a canonical review link and complete version samples',()=>{
  const def=getTemplateDefinition('campaign_ready');assert.ok(def.sampleVariables['1'].trim());assert.match(def.sampleVariables['2'],/^[a-f0-9]{12}$/);const url=new URL(def.sampleVariables['3']);assert.equal(url.protocol,'https:');assert.ok(url.hash.startsWith('#meta-ads-agent?'));assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.search,'');assert.doesNotMatch(def.sampleVariables['3'],/token|secret/iu);
});
test('ACAP-20 the proposed readiness template states that publication still requires approval',async()=>{
  const {prepareSalesWhatsApp,salesDefaults}=await import('../sales-template-content.js');const defaults=salesDefaults('campaign_ready'),prepared=prepareSalesWhatsApp('campaign_ready',defaults.whatsapp.body);assert.match(defaults.whatsapp.body,/só será publicada após aprovação/);assert.doesNotMatch(prepared.metaBody,/\{\{[A-Za-z]/);assert.ok(Object.values(prepared.sampleVariables).every(value=>value.trim()));assert.equal(prepared.category,'UTILITY');assert.doesNotMatch(prepared.metaBody,/^\s*\{\{\d+\}\}/);assert.doesNotMatch(prepared.metaBody,/\{\{\d+\}\}[^\p{L}\p{N}]*$/u);
});
test('ACAP-20 readiness variables cannot expand unrelated order or marketing template scopes',async()=>{
  const {prepareSalesWhatsApp}=await import('../sales-template-content.js');for(const type of ['order_confirmation','follow_up','cross_sell'])assert.throws(()=>prepareSalesWhatsApp(type,'Aviso {{campaignName}}: {{campaignReviewLink}}.'),/unsupported_template_variable/);const prepared=prepareSalesWhatsApp('campaign_ready','Campanha {{campaignName}}, revisão {{campaignVersion}}, consulte {{campaignReviewLink}}.');assert.deepEqual(Object.values(prepared.variableMap),['campaignName','campaignVersion','campaignReviewLink']);
});

test("catalog covers every declared type", () => {
  const cat = buildCatalog();
  for (const t of WHATSAPP_TEMPLATE_TYPES) {
    assert.ok(cat[t], `missing catalog def for ${t}`);
  }
});

test("every def has positional metaBody + coherent variableMap", () => {
  const cat = buildCatalog("Loja X");
  for (const t of WHATSAPP_TEMPLATE_TYPES) {
    const def = cat[t];
    assert.doesNotMatch(def.metaBody, /\{\{[a-zA-Z]/, `${t} metaBody has named placeholder`);
    const positions = [...def.metaBody.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
    for (const p of positions) {
      assert.ok(def.variableMap[p], `${t} variableMap missing pos ${p}`);
      assert.ok(def.sampleVariables[p] !== undefined, `${t} sampleVariables missing pos ${p}`);
    }
    // storeName is inlined, never a positional variable
    assert.ok(!Object.values(def.variableMap).includes("storeName"));
  }
});

test("categories: only cross_sell/win_back/cart_recovery are MARKETING", () => {
  assert.equal(categoryFor("cross_sell"), "MARKETING");
  assert.equal(categoryFor("win_back"), "MARKETING");
  assert.equal(categoryFor("cart_recovery"), "MARKETING");
  assert.equal(categoryFor("follow_up"), "UTILITY");
  assert.equal(categoryFor("order_confirmation"), "UTILITY");
  assert.equal(categoryFor("nps"), "UTILITY");
  assert.equal(categoryFor("checkout_otp"), "AUTHENTICATION");
});

test("coupon-bearing types expose a couponBlock variable", () => {
  const cat = buildCatalog();
  for (const t of ["cross_sell", "win_back", "loyalty", "reorder", "cart_recovery"] as const) {
    assert.ok(Object.values(cat[t].variableMap).includes("couponBlock"), `${t} should have couponBlock`);
  }
  for (const t of ["follow_up", "review_request", "nps", "order_confirmation"] as const) {
    assert.ok(!Object.values(cat[t].variableMap).includes("couponBlock"), `${t} should NOT have couponBlock`);
  }
});

test("order templates surface orderId; shipped surfaces trackingCode", () => {
  const cat = buildCatalog();
  assert.ok(Object.values(cat.order_confirmation.variableMap).includes("orderId"));
  assert.ok(Object.values(cat.order_shipped.variableMap).includes("trackingCode"));
});

test("getTemplateDefinition inlines storeName", () => {
  const def = getTemplateDefinition("follow_up", "Minha Loja");
  assert.match(def.metaBody, /Minha Loja/);
});

test("checkout OTP template has one code variable", () => {
  const def = getTemplateDefinition("checkout_otp");
  assert.deepEqual(def.variableMap, { "1": "otpCode" });
  assert.match(def.metaBody, /\{\{1\}\}/);
});

test("customer notifications identify their company and retain a literal ending after positional conversion", async () => {
  const { prepareSalesWhatsApp, salesDefaults } = await import("../sales-template-content.js");
  for (const def of Object.values(buildCatalog())) {
    if (def.type === "checkout_otp") continue;
    if (!def.type.startsWith("plan_expiry_") && def.type !== "marketplace_operational_alert") assert.ok(def.freeformBody.includes("{{storeName}}"), def.type);
    const prepared = prepareSalesWhatsApp(def.type, salesDefaults(def.type).whatsapp.body);
    assert.doesNotMatch(prepared.metaBody, /^\s*\{\{\d+\}\}/u, def.type);
    assert.doesNotMatch(prepared.metaBody, /\{\{\d+\}\}[^\p{L}\p{N}]*$/u, def.type);
  }
});
