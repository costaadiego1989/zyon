import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl,inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";
const [url,runId,coverageMode]=process.argv.slice(2);assert.equal(process.argv.slice(2).length,3);
assert.ok(["baseline-and-identity","coupon-after-only","benefits-only","identity-only","product-types-only"].includes(coverageMode),"explicit_normal_payment_native_coverage_required");
const parsed=assertNativePrismaUrl(url);assert.match(runId,/^[a-f0-9-]{36}$/);
assert.equal(parsed.searchParams.get("application_name"),`aacp_write_native_${runId}`);
for(const key of ["DATABASE_URL","DIRECT_URL","NODE_OPTIONS","DOTENV_CONFIG_PATH","PRISMA_QUERY_ENGINE_LIBRARY","READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key],undefined,"native_normal_payment_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../",import.meta.url)));
const {PrismaClient}=await import("@prisma/client"),prisma=new PrismaClient({datasources:{db:{url}},log:[]});
let passed=0,active="marker",waiters=0;
const check=async(name,work)=>{active=name;await work();passed++;console.log(JSON.stringify({test:name,status:"passed"}));};
try{
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`,[{run_id:runId}]);
  if(coverageMode==="product-types-only"){
    const {runNormalCheckoutProductTypesNativeCases}=await import("./normal-checkout-product-types.native-cases.mjs");
    await runNormalCheckoutProductTypesNativeCases({prisma,check,runId});
  }else if(coverageMode==="coupon-after-only"){
    const {runNormalCheckoutCouponAfterNativeCases}=await import("./normal-checkout-coupon-after.native-cases.mjs");
    await runNormalCheckoutCouponAfterNativeCases({prisma,check,runId});
  }else if(coverageMode==="benefits-only"){
    const {runNormalCheckoutBenefitsNativeCases}=await import("./normal-checkout-benefits.native-cases.mjs");
    await runNormalCheckoutBenefitsNativeCases({prisma,check,runId});
  }else if(coverageMode==="identity-only"){
    const {runNormalCheckoutIdentityNativeCases}=await import("./normal-checkout-identity.native-cases.mjs");
    await runNormalCheckoutIdentityNativeCases({prisma,check,runId});
    const {runNormalCheckoutDetachmentNativeCases}=await import("./normal-checkout-detachment.native-cases.mjs");
    await runNormalCheckoutDetachmentNativeCases({prisma,check,runId});
  }else{
  const {runNormalCheckoutPaymentNativeCases,runNormalCheckoutSourcePaymentNativeCases}=await import("./normal-checkout-payment.native-cases.mjs");
  await runNormalCheckoutPaymentNativeCases({prisma,check,runId,recordWaiter(){waiters++;}});
  const {runNormalCrossSellSourceNativeCases}=await import("./normal-cross-sell-source.native-cases.mjs");
  await runNormalCrossSellSourceNativeCases({prisma,check,runId,recordWaiter(){waiters++;}});
  await runNormalCheckoutSourcePaymentNativeCases({prisma,check,runId});
  const {runNormalCheckoutIdentityNativeCases}=await import("./normal-checkout-identity.native-cases.mjs");
  await runNormalCheckoutIdentityNativeCases({prisma,check,runId});
  const {runNormalCheckoutDetachmentNativeCases}=await import("./normal-checkout-detachment.native-cases.mjs");
  await runNormalCheckoutDetachmentNativeCases({prisma,check,runId});
  }
  assert.equal(passed,{"baseline-and-identity":48,"coupon-after-only":13,"benefits-only":12,"identity-only":15,"product-types-only":8}[coverageMode],
    "native_normal_payment_incomplete_coverage");
  console.log(JSON.stringify({phase:"normal-checkout-payment",coverageMode,passed,waiters,prismaClientConstructed:true,providerCalls:0,
    scope:coverageMode==="product-types-only"?"normal-product-types-synthetic-approval"
      :coverageMode==="coupon-after-only"?"normal-coupon-after":coverageMode==="benefits-only"?"normal-commercial-benefits"
      :coverageMode==="identity-only"?"normal-identity-and-detachment":"normal-standalone-source-coupon-identity-detachment",
    checkoutVersionTrigger:true,checkoutStrategyTrigger:true}));
}catch(error){console.error(JSON.stringify({status:"failed",active,passed,error:error instanceof Error?error.message:"native_error"}));throw error;}
finally{await prisma.$disconnect();}
