import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgendaDbFixture} from './service-agenda-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T20',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createAgendaDbFixture();
  try{
    const {readProfessionalServiceLink}=await import('../dist/modules/catalog/domain/services/professional-service-link.js');
    const read=input=>f.as(f.owner,()=>readProfessionalServiceLink(f.scoped,input));
    await t.test('same category and professional retain two canonical prices and durations',async()=>{
      const first=await read(f.selection),second=await read({...f.selection,productId:f.owner.merchantId+'-other-service',variantId:f.owner.merchantId+'-other-service-variant'});
      assert.equal(first.professionalId,second.professionalId);assert.equal(first.categoryId,second.categoryId);assert.equal(first.durationMinutes,30);assert.equal(second.durationMinutes,20);assert.equal(first.priceInCents,5000);assert.equal(second.priceInCents,7000);
      assert.equal(await f.raw.serviceProfessional.count({where:{merchantId:f.owner.merchantId}}),2);
    });
    await t.test('foreign professional offer variant and category cannot be resolved',async()=>{
      for(const input of [{...f.selection,professionalId:f.foreignProfessional.id},{...f.selection,productId:f.foreign.merchantId+'-service'},{...f.selection,variantId:f.foreign.merchantId+'-service-variant'}])await assert.rejects(read(input),/not_found/);
      await f.raw.product.update({where:{id:f.selection.productId},data:{categoryId:f.foreign.merchantId+'-category'}});
      await assert.rejects(read(f.selection),/not_found/);
      await f.raw.product.update({where:{id:f.selection.productId},data:{categoryId:f.owner.merchantId+'-category'}});
    });
    await t.test('withdrawn profile service category variant and link are individually ineligible',async()=>{
      const cases=[['serviceProfessional',{id:f.professional.id},{isPublished:false},{isPublished:true}],['product',{id:f.selection.productId},{isActive:false},{isActive:true}],['productCategory',{id:f.owner.merchantId+'-category'},{isActive:false},{isActive:true}],['productVariant',{id:f.selection.variantId},{isActive:false},{isActive:true}]];
      for(const [model,where,bad,restore]of cases){await f.raw[model].update({where,data:bad});await assert.rejects(read(f.selection),/not_available/);await f.raw[model].update({where,data:restore});}
      const link=await f.raw.professionalService.findFirst({where:{merchantId:f.owner.merchantId,professionalId:f.professional.id,productId:f.selection.productId}});
      await f.raw.professionalService.update({where:{id:link.id},data:{isActive:false}});await assert.rejects(read(f.selection),/not_available/);
    });
  }finally{await f.close();}
});
