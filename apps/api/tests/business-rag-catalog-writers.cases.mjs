import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqlText} from './service-company-http-fixture.mjs';
import {businessRagWriterHttp} from './business-rag-writer-http.mjs';

/** Actual source transactions and HTTP controls, with the principal T65's owned
 * runtime. These are prepared cases until the T25 barrier and fresh gate. */
export async function exerciseCatalogWriterCases(t,f){
  const merchantId=f.owner.merchant_id,http=businessRagWriterHttp(f.runtime),base='/merchants/'+merchantId;
  const {TenantContextService}=await import('../dist/shared/tenant/tenant-context.service.js');
  const {registerTenantMiddleware}=await import('../dist/shared/persistence/tenant.middleware.js');
  const {PrismaProductRepository}=await import('../dist/modules/catalog/infrastructure/repositories/prisma-product.repository.js');
  const {PrismaPublicBusinessSources}=await import('../dist/modules/graph-rag/infrastructure/prisma-public-business.sources.js');
  const {PublicSourceWorkService}=await import('../dist/modules/graph-rag/application/public-source-work.service.js');
  const tenant=new TenantContextService(),prisma=f.prisma,scoped=registerTenantMiddleware(prisma,tenant);
  const reader=new PrismaPublicBusinessSources(scoped,tenant),jobs=new PublicSourceWorkService(scoped,tenant,reader),repository=new PrismaProductRepository(scoped);
  const as=work=>tenant.run({merchantId,userId:f.owner.user_id,role:'owner'},work);
  const read=(type,id)=>as(()=>reader.read(merchantId,type,id));
  const latest=(type,id)=>prisma.publicSourceWork.findFirst({where:{merchantId,sourceType:type,sourceId:id,sourceVersion:{startsWith:'public-v1:'}},orderBy:{sourceVersion:'desc'}});
  const request=async(path,body,method='PUT',expectedStatus=200)=>{
    const correlationId=randomUUID();
    const response=await http.request(path,body,f.owner.access_token,method,{'idempotency-key':'synthetic-catalog-source-'+randomUUID(),'x-correlation-id':correlationId});
    assert.equal(response.status,expectedStatus,JSON.stringify({path,status:response.status,body:response.body}));
    const deadline=Date.now()+5000;let audit;
    do{audit=await f.prisma.merchantAuditEvent.findFirst({where:{merchantId,correlationId}});}while(!audit&&Date.now()<deadline);
    assert.ok(audit,'The actual mutation audit must settle before state snapshots and teardown');
    assert.equal(audit.actorId,f.owner.user_id);assert.equal(audit.action,'http.'+method.toLowerCase());
    assert.equal(audit.metadata.statusCode,expectedStatus);assert.equal(audit.outcome,expectedStatus<400?'success':'failed');
    return response.body;
  };
  const snapshot=async()=>({
    merchant:await prisma.merchant.findUnique({where:{id:merchantId}}),
    policy:await prisma.serviceBusinessPolicy.findUnique({where:{merchantId}}),
    professionals:await prisma.serviceProfessional.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    links:await prisma.professionalService.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    recurring:await prisma.professionalAvailability.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    exceptions:await prisma.availabilityException.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    categories:await prisma.productCategory.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    products:await prisma.product.findMany({where:{merchantId},orderBy:{id:'asc'},include:{variants:{orderBy:{id:'asc'},include:{price:true,stock:{orderBy:{id:'asc'}},media:{orderBy:{id:'asc'}}}}}}),
    inventory:await prisma.inventoryItem.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    movements:await prisma.inventoryMovement.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    work:await prisma.publicSourceWork.findMany({where:{merchantId},orderBy:{id:'asc'}}),
    chunks:await prisma.knowledgeChunk.findMany({where:{merchantId},orderBy:{id:'asc'}}),
  });
  const failWithin=async(type,work)=>{
    const name='synthetic_catalog_source_failure_t65';
    const sequence=name+'_reached';
    await f.runtime.db.sql(`CREATE SEQUENCE ${sequence}; CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id=${sqlText(merchantId)} AND NEW.source_type::text=${sqlText(type)} THEN PERFORM nextval('${sequence}'); RAISE EXCEPTION 'synthetic_catalog_source_work_rejected'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON public_source_work FOR EACH ROW EXECUTE FUNCTION ${name}();`);
    try{
      const before=await snapshot();await work();
      assert.equal(Number(await f.runtime.db.sql(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM ${sequence}`)),1,'The intended work trigger must actually cause the rollback');
      assert.deepEqual(await snapshot(),before);
    }finally{await f.runtime.db.sql(`DROP TRIGGER ${name} ON public_source_work; DROP FUNCTION ${name}(); DROP SEQUENCE ${sequence};`);}
  };
  const productInput={name:'Source rollback consultation',description:'Public service transaction baseline',type:'service',
    metadata:{serviceType:'presencial',serviceSchedule:{timeZone:'UTC',durationMinutes:30,slots:[]}},
    variants:[{sku:'synthetic-source-rollback-service',attributes:{},basePriceInCents:12000,stockQuantity:5}]};
  const product=await request(base+'/products',productInput,'POST',201);
  const professional=await request(base+'/service-professionals',{...f.profile,publicName:'Source rollback professional',productIds:[product.id]},'POST',201);
  const version=async()=>(await prisma.serviceProfessional.findUnique({where:{id:professional.id}})).version;

  await t.test('RAG-11 actual professional creation and public profile update roll back when work cannot persist',async()=>{
    await failWithin('professional',()=>request(base+'/service-professionals',{...f.profile,publicName:'Rejected new public profile'},'POST',500));
    await failWithin('professional',async()=>request(base+'/service-professionals/'+professional.id,{expectedVersion:await version(),publicName:'Rejected profile edit'},'PATCH',500));
  });

  await t.test('RAG-11 delinking a professional rolls back the link and public profile together',async()=>{
    await failWithin('service',async()=>request(base+'/service-professionals/'+professional.id,{expectedVersion:await version(),productIds:[]},'PATCH',500));
    assert.equal(await prisma.professionalService.count({where:{merchantId,professionalId:professional.id,productId:product.id,isActive:true}}),1);
  });

  await t.test('RAG-11 actual recurring editor rolls back timezone grade and version and later publishes only timezone',async()=>{
    // Explicit stored historical row; every new HTTP grade still passes the Brasilia guard.
    const historical=await prisma.serviceProfessional.create({data:{merchantId,...f.profile,publicName:'Historical UTC recurring source',timeZone:'UTC'}});
    await as(()=>jobs.normalizeCurrent(merchantId,'professional',historical.id));
    const before=await read('professional',historical.id);assert.equal(before.publicData.timeZone,'UTC');
    const path=base+'/service-professionals/'+historical.id+'/availability';
    const historicalVersion=async()=>(await prisma.serviceProfessional.findUnique({where:{id:historical.id}})).version;
    const body={expectedVersion:await historicalVersion(),timeZone:'America/Sao_Paulo',rows:[{weekday:1,startMinute:540,endMinute:600}]};
    await failWithin('professional',()=>request(path,body,'PUT',500));
    const saved=await request(path,body);assert.equal(saved.timeZone,'America/Sao_Paulo');
    const source=await read('professional',historical.id),work=await latest('professional',historical.id);
    assert.equal(source.publicData.timeZone,'America/Sao_Paulo');assert.equal(work.sourceHash,source.sourceHash);
    assert.deepEqual(source.publicData,{...before.publicData,timeZone:'America/Sao_Paulo'});assert.notEqual(source.sourceHash,before.sourceHash);
    assert.equal(Object.hasOwn(source.publicData,'rows'),false);assert.equal(Object.hasOwn(source.publicData,'startMinute'),false);
    const stable=work;
    await request(path,{expectedVersion:await historicalVersion(),timeZone:'America/Sao_Paulo',rows:[{weekday:2,startMinute:600,endMinute:720}]});
    assert.deepEqual(await latest('professional',historical.id),stable,'A private grade-only change preserves the public revision');
  });

  await t.test('RAG-11 actual service create update and delete roll back public work stock and source state',async()=>{
    await failWithin('service',()=>request(base+'/products',{...productInput,name:'Rejected service creation',variants:[{...productInput.variants[0],sku:'synthetic-rejected-service'}]},'POST',500));
    await failWithin('service',()=>request(base+'/products/'+product.id,{description:'Rejected service description'},'PUT',500));
    await failWithin('service',()=>request(base+'/products/'+product.id,undefined,'DELETE',500));
  });

  await t.test('RAG-11 actual variant-set editor rolls back replacement and public detail changes',async()=>{
    const variant=await prisma.productVariant.findFirstOrThrow({where:{productId:product.id,isActive:true}});
    await failWithin('service',()=>request(base+'/products/'+product.id+'/variants',{
      variants:[{id:variant.id,sku:variant.sku,attributes:{},basePriceInCents:12500,stockQuantity:5}],
      product:{description:'Rejected variant editor public introduction'},
    },'PUT',500));
  });

  await t.test('RAG-11 import SKU writer uses the same canonical transaction and queues the resulting public name',async()=>{
    const sku=productInput.variants[0].sku;
    await failWithin('service',()=>assert.rejects(as(()=>repository.updateVariantBySku(merchantId,sku,{productName:'Rejected imported public name'})),/synthetic_catalog_source_work_rejected/));
    await as(()=>repository.updateVariantBySku(merchantId,sku,{productName:'Current imported public name'}));
    const source=await read('service',product.id),work=await latest('service',product.id);
    assert.equal(source.publicData.name,'Current imported public name');assert.equal(work.sourceHash,source.sourceHash);
  });

  await t.test('RAG-11 internal variant addition handles a named legacy offer with no active variants atomically',async()=>{
    // This is an explicit historical state, not an invented zero-variant HTTP
    // control: the normal product editor correctly requires at least one offer.
    await prisma.productVariant.updateMany({where:{productId:product.id},data:{isActive:false}});
    await as(()=>jobs.normalizeCurrent(merchantId,'service',product.id));
    assert.equal((await read('service',product.id)).publicationState,'withdrawn');
    const variant={sku:'synthetic-restored-legacy-variant',attributes:{},basePriceInCents:13000,stockQuantity:5};
    await failWithin('service',()=>assert.rejects(as(()=>repository.addVariant(merchantId,product.id,variant)),/synthetic_catalog_source_work_rejected/));
    await as(()=>repository.addVariant(merchantId,product.id,variant));
    const source=await read('service',product.id),work=await latest('service',product.id);
    assert.equal(source.publicationState,'published');assert.equal(work.sourceHash,source.sourceHash);
  });
}
