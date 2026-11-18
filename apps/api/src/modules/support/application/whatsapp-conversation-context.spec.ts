import assert from "node:assert/strict";
import test from "node:test";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { conversationContext } from "./whatsapp-conversation-context.js";

test("T58 minimal conversation context is a separate closed contract", async t => {
  await t.test("all already-authorized support roles receive only canonical identity", () => {
    for (const role of ["owner","admin","staff"] as const) {
      const actual=conversationContext({kind:"human",tenantId:"merchant-a",userId:"user-a",email:"private@example.test",role});
      assert.deepEqual(actual,{merchant_id:"merchant-a",user_id:"user-a",role:role.toUpperCase()});
      assert.deepEqual(Object.keys(actual).sort(),["merchant_id","role","user_id"]);
    }
  });
  await t.test("machine, absent and unknown principals gain no operator context", () => {
    for (const value of [undefined,{kind:"service",tenantId:"merchant-a",credentialId:"key-a",environment:"test",scopes:["support:read"]},
      {kind:"human",tenantId:"merchant-a",userId:"user-a",role:"unknown"}])
      assert.throws(()=>conversationContext(value as TenantPrincipal),/human_operator_required/);
  });
  await t.test("a context is not a MerchantProfile or configuration permission", () => {
    const actual=conversationContext({kind:"human",tenantId:"merchant-a",userId:"user-a",email:"private@example.test",role:"staff"});
    for(const key of ["id","name","email","storeSettings","credentials","tokens","configuration","subscription","businessMode"])
      assert.equal(Object.hasOwn(actual,key),false,key);
  });
});
