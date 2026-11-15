import assert from 'node:assert/strict';
import test from 'node:test';
import {createProfessionalHttpFixture} from './service-professional-http-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T20',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createProfessionalHttpFixture();
  try{
    const category=await f.prisma.productCategory.create({data:{merchantId:f.owner.merchant_id,name:'Canonical category',slug:'canonical'}});
    const product=await f.prisma.product.create({data:{merchantId:f.owner.merchant_id,name:'Synthetic shared category service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},categoryId:category.id,variants:{create:{sku:'eligibility',price:{create:{basePriceInCents:5000,currency:'BRL'}}}}},include:{variants:true}});
    const created=await f.request(f.path(f.owner),{...f.profile,productIds:[product.id]},f.owner);assert.equal(created.status,201,JSON.stringify(created));
    const professional=created.body;
    const draft=await f.request(f.path(f.owner),{...f.profile,publicName:'Draft professional',isPublished:false,productIds:[product.id]},f.owner);assert.equal(draft.status,201);
    const query='?productId='+product.id+'&variantId='+product.variants[0].id,base=f.path(f.owner)+'/eligible';
    await t.test('real eligibility query exposes canonical price duration and only published active resources',async()=>{
      const response=await f.request(base+query,undefined,f.owner,'GET');assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.body.items.length,1);
      const item=response.body.items[0];assert.equal(item.professionalId,professional.id);assert.equal(item.productId,product.id);assert.equal(item.variantId,product.variants[0].id);assert.equal(item.priceInCents,5000);assert.equal(item.durationMinutes,30);assert.equal(item.publicName,f.profile.publicName);assert.deepEqual(item.publicProfile,f.profile.publicProfile);assert.equal(item.timeZone,f.profile.timeZone);assert.equal(response.body.nextCursor,null);
      await f.prisma.serviceProfessional.update({where:{id:professional.id},data:{publicProfile:{...f.profile.publicProfile,privateNotes:'Private eligibility canary',customerSnapshot:{name:'Private buyer canary'},userId:'private-login'}}});
      const safe=await f.request(base+query,undefined,f.owner,'GET');assert.equal(safe.status,200);assert.deepEqual(safe.body.items[0].publicProfile,f.profile.publicProfile);assert.equal(JSON.stringify(safe.body).includes('Private eligibility canary'),false);assert.equal(JSON.stringify(safe.body).includes('Private buyer canary'),false);assert.equal(JSON.stringify(safe.body).includes('private-login'),false);
      await f.prisma.serviceProfessional.update({where:{id:professional.id},data:{publicProfile:f.profile.publicProfile}});
      const publishedDraft=await f.request(f.path(f.owner)+'/'+draft.body.id,{expectedVersion:1,isPublished:true},f.owner,'PATCH');assert.equal(publishedDraft.status,200);
      const page=await f.request(base+query+'&limit=1',undefined,f.owner,'GET');assert.equal(page.status,200);assert.equal(page.body.items.length,1);assert.ok(page.body.nextCursor);
      const next=await f.request(base+query+'&limit=1&cursor='+page.body.nextCursor,undefined,f.owner,'GET');assert.equal(next.status,200);assert.equal(next.body.items.length,1);assert.equal(next.body.nextCursor,null);assert.deepEqual([page.body.items[0].professionalId,next.body.items[0].professionalId].sort(),[professional.id,draft.body.id].sort());
      assert.equal((await f.request(f.path(f.owner)+'/'+draft.body.id+'/deactivate',{expectedVersion:2},f.owner)).status,201);
      const withdrawal=await f.request(f.path(f.owner)+'/'+professional.id+'/deactivate',{expectedVersion:1},f.owner);assert.equal(withdrawal.status,201);
      assert.deepEqual((await f.request(base+query,undefined,f.owner,'GET')).body.items,[]);
    });
    await t.test('staff reads published eligibility only in its authenticated tenant and anonymous requests fail',async()=>{
      const offer=await f.prisma.product.create({data:{merchantId:f.staff.merchant_id,name:'Synthetic staff service',type:'service',metadata:{serviceSchedule:{timeZone:'UTC',durationMinutes:20,slots:[]}},variants:{create:{sku:'staff-eligibility',price:{create:{basePriceInCents:3000,currency:'BRL'}}}}},include:{variants:true}});
      const pro=await f.prisma.serviceProfessional.create({data:{merchantId:f.staff.merchant_id,publicName:'Synthetic staff-readable professional',timeZone:'UTC',isPublished:true}});
      await f.prisma.professionalService.create({data:{merchantId:f.staff.merchant_id,professionalId:pro.id,productId:offer.id}});
      const target=f.path(f.staff)+'/eligible?productId='+offer.id+'&variantId='+offer.variants[0].id;
      const read=await f.request(target,undefined,f.staff,'GET');assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.body.items.length,1);assert.equal(read.body.items[0].professionalId,pro.id);assert.equal(read.body.items[0].merchantId,f.staff.merchant_id);assert.equal(read.body.items[0].productId,offer.id);assert.equal(read.body.items[0].variantId,offer.variants[0].id);assert.equal(read.body.items[0].durationMinutes,20);assert.equal(read.body.items[0].priceInCents,3000);
      assert.equal((await f.request(target,undefined,undefined,'GET')).status,401);assert.equal((await f.request(base+query,undefined,f.staff,'GET')).status,403);
    });
    await t.test('foreign resources products and malformed queries cannot reveal eligibility',async()=>{
      assert.equal((await f.request(base+query,undefined,f.foreign,'GET')).status,403);
      assert.equal((await f.request(f.path(f.products)+'/eligible'+query,undefined,f.products,'GET')).status,403);
      assert.equal((await f.request(f.path(f.foreign)+'/eligible'+query,undefined,f.foreign,'GET')).status,404);
      assert.equal((await f.request(base+query+'&limit=101',undefined,f.owner,'GET')).status,400);
      await f.prisma.productCategory.update({where:{id:product.categoryId},data:{isActive:false}});
      assert.equal((await f.request(base+query,undefined,f.owner,'GET')).status,404);
      assert.equal(await f.prisma.serviceProfessional.count({where:{merchantId:f.owner.merchant_id}}),2);
    });
    assert.equal(f.runtime.evidence().providerCalls,0);
  }finally{await f.close();}
});
