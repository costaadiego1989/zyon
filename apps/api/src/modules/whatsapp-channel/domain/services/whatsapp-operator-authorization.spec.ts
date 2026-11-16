import assert from "node:assert/strict";
import test from "node:test";
import { authorizeWhatsAppOperator } from "./whatsapp-operator-authorization.js";
import type { HandoffState } from "./whatsapp-handoff-state.js";
import type { HumanTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
const scope={merchantId:"merchant",configId:"config",whatsappSessionId:"session"};
const human:HumanTenantPrincipal={kind:"human",tenantId:"merchant",userId:"operator",email:"synthetic@example.test",role:"staff"};
const binding:HandoffState={id:"binding",...scope,ticketId:"ticket",mode:"human",epoch:2,assignedOperatorId:"operator"};
const ticket={id:"ticket",merchantId:"merchant",sessionId:"session",source:"whatsapp",status:"in_progress",mergedIntoId:null,assignedTo:"operator"};

test("T53 exact claimed operator receives an immutable original case snapshot",()=>{
 const current=Object.freeze({...binding});const result=authorizeWhatsAppOperator(scope,current,ticket,human);
 assert.deepEqual(result,{...scope,bindingId:"binding",ticketId:"ticket",epoch:2,operatorId:"operator"});assert.equal(Object.isFrozen(result),true);
 assert.deepEqual(current,binding);
});
test("T53 owner admin and staff follow the same canonical claim instead of free role flags",()=>{
 for(const role of ["owner","admin","staff"] as const)assert.equal(authorizeWhatsAppOperator(scope,binding,ticket,{...human,role}).operatorId,"operator");
});
test("T53 service or missing principal cannot become a human sender",()=>{
 assert.throws(()=>authorizeWhatsAppOperator(scope,binding,ticket,undefined),/human_operator_required/);
 assert.throws(()=>authorizeWhatsAppOperator(scope,binding,ticket,{kind:"service",tenantId:"merchant",credentialId:"key",environment:"test",scopes:["support:write"]}),/human_operator_required/);
});
test("T53 another tenant or operator cannot inherit the active claim",()=>{
 assert.throws(()=>authorizeWhatsAppOperator(scope,binding,ticket,{...human,tenantId:"foreign"}),/operator_scope_forbidden/);
 assert.throws(()=>authorizeWhatsAppOperator(scope,binding,ticket,{...human,userId:"other"}),/whatsapp_claim_owned_by_another_operator/);
});
test("T53 each merchant config session and ticket fence is independent",()=>{
 for(const field of ["merchantId","configId","whatsappSessionId"] as const)assert.throws(()=>authorizeWhatsAppOperator(scope,{...binding,[field]:"foreign"},ticket,human),/whatsapp_case_not_found/);
 assert.throws(()=>authorizeWhatsAppOperator(scope,{...binding,ticketId:"other"},ticket,human),/whatsapp_case_not_found/);
 assert.throws(()=>authorizeWhatsAppOperator(scope,null,ticket,human),/whatsapp_case_not_found/);
});
test("T53 widget aliases foreign or merged tickets cannot acquire WhatsApp authority",()=>{
 for(const patch of [{source:"widget"},{merchantId:"foreign"},{sessionId:"other"},{mergedIntoId:"other"}])
  assert.throws(()=>authorizeWhatsAppOperator(scope,binding,{...ticket,...patch},human),/whatsapp_case_not_found/);
});
test("T53 waiting AI open and closed states do not allow an operator submission",()=>{
 for(const mode of ["ai","waiting_human"] as const)assert.throws(()=>authorizeWhatsAppOperator(scope,{...binding,mode},ticket,human),/whatsapp_conversation_not_claimed/);
 for(const status of ["open","closed","resolved"])assert.throws(()=>authorizeWhatsAppOperator(scope,binding,{...ticket,status},human),/whatsapp_conversation_not_claimed/);
});
test("T53 ticket and binding assignments must agree with the actual actor",()=>{
 assert.throws(()=>authorizeWhatsAppOperator(scope,{...binding,assignedOperatorId:"other"},ticket,human),/whatsapp_claim_owned_by_another_operator/);
 assert.throws(()=>authorizeWhatsAppOperator(scope,binding,{...ticket,assignedTo:null},human),/whatsapp_claim_owned_by_another_operator/);
});
