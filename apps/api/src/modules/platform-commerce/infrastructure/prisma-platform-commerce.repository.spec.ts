import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaPlatformCommerceRepository } from "./prisma-platform-commerce.repository.js";

function companyRepository(settings: unknown, users: Array<{email:unknown}> = []) {
  return new PrismaPlatformCommerceRepository({
    merchant:{findUnique:async(input:{where:unknown;select:{users:unknown;storeSettings?:unknown}})=>{
      assert.deepEqual(input.where,{id:'company_a'});
      assert.equal(input.select.storeSettings,true);
      assert.deepEqual(input.select.users,{where:{role:'owner',disabledAt:null},orderBy:[{createdAt:'asc'},{id:'asc'}],take:1,select:{email:true}});
      return{id:'company_a',name:'Empresa A',plan:'BOTH',createdAt:new Date('2026-11-01'),storeSettings:settings,users};
    }},
    completedOrder:{aggregate:async()=>({_count:{_all:0},_sum:{orderTotal:null}}),findMany:async()=>[]},
    merchantBillingSubscription:{findUnique:async()=>null},billingReceivable:{findMany:async()=>[]},
    aiUsageEvent:{aggregate:async()=>({_sum:{totalTokens:0,costMicros:0n},_count:{_all:0}})},
  } as unknown as PrismaClient);
}
const period={from:new Date('2026-11-01'),to:new Date('2026-12-01')};
test('ADM-02 company profile returns only its registered business fields and separate account email',async()=>{
  const company={cnpj:'00ABC345000135',razaoSocial:'Empresa A Comércio',inscricaoEstadual:'ISENTO',email:'contato@empresa.test',phone:'+5511998765432',address:{street:'Rua Um',number:'10',complement:'Sala 2',neighborhood:'Centro',city:'São Paulo',state:'SP',zip:'01001000'}};
  const result=await companyRepository({company:{...company,apiKey:'DO_NOT_RETURN',address:{...company.address,secret:'PRIVATE'}},providerToken:'SECRET'},[{email:'titular@empresa.test'}]).merchantDetail('company_a',period);
  assert.deepEqual(result?.merchant.company,company);
  assert.equal(result?.merchant.registrationEmail,'titular@empresa.test');
  assert.equal(result?.merchant.id,'company_a');
  assert.ok(!JSON.stringify(result,(_key,value)=>typeof value==='bigint'?value.toString():value).includes('DO_NOT_RETURN'));
  assert.ok(!JSON.stringify(result,(_key,value)=>typeof value==='bigint'?value.toString():value).includes('SECRET'));
});
test('ADM-02 blank and non-string owner emails are absent while valid owner emails are trimmed',async()=>{
  for(const email of ['   ','',null,42]) {
    const result=await companyRepository({company:{email:'contato@empresa.test'}},[{email}]).merchantDetail('company_a',period);
    assert.equal(Object.hasOwn(result!.merchant,'registrationEmail'),false);
    assert.equal(result?.merchant.company?.email,'contato@empresa.test');
  }
  const result=await companyRepository(null,[{email:' titular@empresa.test  '}]).merchantDetail('company_a',period);
  assert.equal(result?.merchant.registrationEmail,'titular@empresa.test');
});
test('ADM-02 missing or malformed profile fields remain absent',async()=>{
  for(const settings of [null,[],{company:null},{company:{cnpj:42,email:' ',phone:{value:'123'},address:'wrong'}}]) {
    const result=await companyRepository(settings).merchantDetail('company_a',period);
    assert.equal(result?.merchant.company,undefined);
    assert.equal(result?.merchant.registrationEmail,undefined);
    assert.equal(result?.merchant.name,'Empresa A');
  }
});
test('ADM-02 company and owner addresses are independent when only one is available',async()=>{
  const businessOnly=await companyRepository({company:{email:'contato@empresa.test'}}).merchantDetail('company_a',period);
  assert.equal(businessOnly?.merchant.company?.email,'contato@empresa.test');
  assert.equal(Object.hasOwn(businessOnly!.merchant,'registrationEmail'),false);
  const ownerOnly=await companyRepository(null,[{email:'titular@empresa.test'}]).merchantDetail('company_a',period);
  assert.equal(ownerOnly?.merchant.company,undefined);
  assert.equal(ownerOnly?.merchant.registrationEmail,'titular@empresa.test');
});

test("PrismaPlatformCommerceRepository keeps store operations local and reads billing from the account", async () => {
  const subscriptionQueries: unknown[] = [];
  const receivableQueries: unknown[] = [];
  const repository = new PrismaPlatformCommerceRepository({
    merchant: {
      findUnique: async () => ({
        id: "child_store",
        name: "Loja filha",
        storeSlug: "loja-filha",
        storeCategory: null,
        plan: "BOTH",
        billingAccountMerchantId: "billing_account",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    },
    completedOrder: {
      aggregate: async () => ({ _count: { _all: 0 }, _sum: { orderTotal: null } }),
      findMany: async () => [],
    },
    merchantBillingSubscription: {
      findUnique: async (input: unknown) => {
        subscriptionQueries.push(input);
        return { status: "active", provider: "stripe", planKey: "scale", billingAmountCents: 74900, billingCycle: "monthly", currentPeriodEnd: null };
      },
    },
    billingReceivable: {
      findMany: async (input: unknown) => {
        receivableQueries.push(input);
        return [];
      },
    },
    aiUsageEvent: {
      aggregate: async () => ({ _sum: { totalTokens: 0, costMicros: 0n }, _count: { _all: 0 } }),
    },
  } as unknown as PrismaClient);

  const detail = await repository.merchantDetail("child_store", {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-10-01T00:00:00.000Z"),
  });

  assert.equal(detail?.merchant.id, "child_store");
  assert.equal(detail?.billing.planKey, "scale");
  assert.deepEqual(subscriptionQueries, [{
    where: { merchantId: "billing_account" },
    select: { status: true, provider: true, planKey: true, billingAmountCents: true, billingCycle: true, currentPeriodEnd: true },
  }]);
  assert.deepEqual(receivableQueries, [{
    where: { merchantId: "billing_account", status: { in: ["open", "pending", "due", "overdue"] } },
    select: { status: true, dueAt: true },
    orderBy: { dueAt: "asc" },
  }]);
});
