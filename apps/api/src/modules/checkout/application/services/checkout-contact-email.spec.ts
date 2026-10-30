import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { OtpService } from "./otp.service.js";
import { deriveChatStage, missingFieldsForStage } from "../../domain/services/customer-extraction.service.js";

test("a checkout email is captured without sending a code, verifying an account or reading its saved profile", async () => {
 const session:any={merchantId:"merchant",sessionId:"checkout",globalUserId:"guest",cart:{items:[],currency:"BRL",total:3},customer:{phone:"11988887777",phone_verified:true}};
 let saves=0;
 const unexpected=()=>assert.fail("contact collection must not access account authentication or saved profiles");
 const service=new CheckoutCustomerService({commitCommercialMutation:async({next}:any)=>{saves++;return next}} as any,
  undefined,new OtpService(),{recognizeVerifiedBuyer:unexpected} as any,{isRegistrationComplete:()=>false,ensureBuyerAccountPersisted:unexpected} as any,{send:unexpected} as any);
 const result=await service.processCustomerInput(session,"buyer@example.com",undefined,"Loja");
 assert.equal(result.customer?.email,"buyer@example.com");assert.notEqual(result.customer?.email_verified,true);
 assert.equal(result.customer?.otp_code,undefined);assert.equal(result.globalUserId,"guest");assert.equal(saves,1);
 assert.equal(session.customer.email,undefined);
});

test("complete contact details can reach payment without an email verification challenge", () => {
 const session:any={chatHistory:[],cart:{items:[{productType:"digital"}]},customer:{fullName:"Joao Silva",email:"buyer@example.com",email_verified:false,cpf:"52998224725",phone:"11988887777"}};
 assert.equal(deriveChatStage(session),"payment");
 assert.deepEqual(missingFieldsForStage(session,"data_collection"),[]);
 session.customer.otp_code="123456";
 assert.deepEqual(missingFieldsForStage(session,"data_collection"),[]);
 assert.equal(session.customer.email_verified,false);
});

test("removing checkout email verification retains required contact and delivery data", () => {
 const session:any={chatHistory:[],cart:{items:[{productType:"physical"}]},customer:{email:"buyer@example.com",phone:"11988887777"}};
 assert.deepEqual(missingFieldsForStage(session,"data_collection"),["nome","CPF"]);
 session.customer.fullName="Joao Silva";session.customer.cpf="52998224725";
 assert.equal(deriveChatStage(session),"shipping");
 assert.deepEqual(missingFieldsForStage(session,"shipping"),["CEP"]);
});
