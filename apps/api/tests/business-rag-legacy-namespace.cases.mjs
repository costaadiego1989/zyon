import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Called by the owned real AppModule/DB fixture. No provider or repository override.
// These functions register child cases only; they do not create another runtime.
const namespace='public-business-v1';
const vector=score=>[score,Math.sqrt(1-score*score),...Array(382).fill(0)];
const query=vector(1),orthogonal=vector(0);
const publicMetadata={publicSourceNamespace:namespace,schemaVersion:1,
  sourceVersion:'public-v1:00000000000000000001',sourceHash:'a'.repeat(64),publicationState:'published',
  embeddingModel:'Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b12046f11709e9df2c122e59ffbdc2f900:q8:mean-normalized:v1',
  embeddingDimensions:384};

async function prepare(f,path){
  const {PrismaKnowledgeRepository}=await import('../dist/modules/knowledge-base/infrastructure/repositories/prisma-knowledge.repository.js');
  const {PUBLIC_BUSINESS_SOURCE_NAMESPACE}=await import('../dist/modules/knowledge-base/domain/knowledge-chunk-namespace.js');
  assert.equal(PUBLIC_BUSINESS_SOURCE_NAMESPACE,namespace);
  const catalog=await f.prisma.$queryRawUnsafe(`SELECT format_type(a.atttypid,a.atttypmod) AS type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='knowledge_chunks' AND a.attname='embedding_vec' AND NOT a.attisdropped`);
  const hasVector=catalog.length===1;
  if(path==='pgvector'){
    const extension=await f.prisma.$queryRawUnsafe("SELECT extversion FROM pg_extension WHERE extname='vector'");
    assert.equal(extension.length,1,'native pgvector proof requires the actual approved local extension; no skip/fake branch');
    assert.equal(catalog[0]?.type,'vector(384)','native pgvector proof requires the existing actual 384-dimension column');
    assert.equal(Number((await f.prisma.$queryRawUnsafe('SELECT 1-($1::vector(384) <=> $1::vector(384)) AS similarity',JSON.stringify(query)))[0].similarity),1);
  }
  const suffix='namespace-'+path+'-'+randomUUID();
  const own=await f.register('products',suffix),foreign=await f.register('products',suffix+'-foreign');
  const merchantId=own.merchant_id,foreignId=foreign.merchant_id,sourceId=suffix+'-faq';
  const repo=new PrismaKnowledgeRepository(f.prisma),ids={};
  const seed=async(key,owner,type,source,score,metadata=null)=>{
    const id=suffix+'-'+key;ids[key]=id;
    // Orthogonal JSON in the pgvector cases proves a JSON fallback cannot make
    // their positive assertions pass. JSON cases have no non-null vector rows.
    const embedding=path==='pgvector'?orthogonal:vector(score);
    await f.prisma.$executeRawUnsafe(`INSERT INTO knowledge_chunks
      (id,merchant_id,source_type,source_id,content,embedding,metadata,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())`,id,owner,type,source,'Synthetic namespace '+key,
      JSON.stringify(embedding),metadata===null?null:JSON.stringify(metadata));
    if(path==='pgvector')await f.prisma.$executeRawUnsafe('UPDATE knowledge_chunks SET embedding_vec=$1::vector(384) WHERE id=$2',JSON.stringify(vector(score)),id);
  };
  await seed('legacy-faq',merchantId,'faq',sourceId,0.97);
  await seed('legacy-custom',merchantId,'faq',sourceId,0.7,{publicSourceNamespace:'unrelated-legacy-marker'});
  for(let i=0;i<8;i++)await seed('public-'+i,merchantId,'faq',sourceId,1,{...publicMetadata,chunkId:'public-'+i});
  await seed('foreign',foreignId,'faq',sourceId,1);
  const products=[];
  for(const [key,type,isActive,deletedAt,owner] of [
    ['physical','physical',true,null,merchantId],['digital','digital',true,null,merchantId],
    ['food','food',true,null,merchantId],['inactive','physical',false,null,merchantId],
    ['deleted','digital',true,new Date('2026-01-01T00:00:00Z'),merchantId],
    ['foreign-product','physical',true,null,foreignId],
  ]){
    const product=await f.prisma.product.create({data:{id:suffix+'-'+key,merchantId:owner,name:'Synthetic '+key,type,isActive,deletedAt}});
    products.push(product.id);
    await seed(key,merchantId,'product',product.id,key==='physical'||key==='digital'||key==='food'?0.8:1);
  }
  if(path==='json'&&hasVector){
    assert.equal(Number((await f.prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM knowledge_chunks WHERE merchant_id=$1 AND embedding_vec IS NOT NULL',merchantId))[0].count),0,
      'JSON positive fixtures must not contain an eligible primary vector');
  }
  const snapshot=async()=>{
    const rows=await f.prisma.knowledgeChunk.findMany({where:{merchantId:{in:[merchantId,foreignId]}},orderBy:{id:'asc'}});
    if(!hasVector)return rows;
    const vectors=await f.prisma.$queryRawUnsafe('SELECT id,embedding_vec::text AS vector FROM knowledge_chunks WHERE merchant_id IN ($1,$2)',merchantId,foreignId);
    const byId=new Map(vectors.map(row=>[row.id,row.vector]));
    return rows.map(row=>({...row,embeddingVector:byId.get(row.id)}));
  };
  const cleanup=async()=>{
    await f.prisma.knowledgeChunk.deleteMany({where:{merchantId:{in:[merchantId,foreignId]}}});
    await f.prisma.product.deleteMany({where:{id:{in:products}}});
  };
  return{merchantId,foreignId,sourceId,repo,ids,seed,snapshot,cleanup,hasVector};
}

async function exercise(t,f,path){
  const p=await prepare(f,path);
  try{
    await t.test('T66 '+path+' native excludes higher-scoring public rows before the limit',async()=>{
      const before=await p.snapshot();
      const result=await p.repo.similaritySearch(p.merchantId,query,1,0.65);
      assert.deepEqual(result.map(row=>row.id),[p.ids['legacy-faq']]);
      assert.equal(result[0].metadata,undefined,'SQL-null legacy metadata remains admissible');
      assert.deepEqual(await p.snapshot(),before,'retrieval does not mutate either representation');
    });
    await t.test('T66 '+path+' native preserves physical digital food and tenant active deleted guards',async()=>{
      const result=await p.repo.similaritySearch(p.merchantId,query,20,0.65);
      assert.deepEqual(result.map(row=>row.id).sort(),['legacy-faq','legacy-custom','physical','digital','food'].map(key=>p.ids[key]).sort());
      assert.ok(result.every(row=>row.merchantId===p.merchantId&&row.metadata?.publicSourceNamespace!==namespace));
      assert.ok(result.some(row=>row.metadata?.publicSourceNamespace==='unrelated-legacy-marker'));
      assert.equal(result.some(row=>['inactive','deleted','foreign-product','foreign'].some(key=>row.id===p.ids[key])),false);
    });
    await t.test('T66 '+path+' native legacy replacement deletion and reserved metadata preserve public and foreign rows',async()=>{
      const sourceTypes=['faq','policy'];
      await p.seed('public-policy',p.merchantId,'policy','returns',1,publicMetadata);
      await p.seed('legacy-policy',p.merchantId,'policy','returns',0.9,{});
      const original=await p.snapshot();
      const retained=original.filter(row=>row.metadata?.publicSourceNamespace===namespace||row.merchantId===p.foreignId);
      const kept=async()=>assert.deepEqual((await p.snapshot()).filter(row=>row.metadata?.publicSourceNamespace===namespace||row.merchantId===p.foreignId),retained);
      for(const sourceType of sourceTypes){
        const sourceId=sourceType==='faq'?p.sourceId:'returns';
        const payload=[{content:'Synthetic updated legacy '+sourceType,embedding:query,metadata:{question:'Legacy metadata'}}];
        await p.repo.upsertChunks(p.merchantId,sourceType,sourceId,payload);await kept();
        await p.repo.upsertChunks(p.merchantId,sourceType,sourceId,payload);await kept();
        const legacy=await f.prisma.knowledgeChunk.findMany({where:{merchantId:p.merchantId,sourceType,sourceId}});
        assert.equal(legacy.filter(row=>row.metadata?.publicSourceNamespace!==namespace).length,1);
        const beforeReserved=await p.snapshot();
        await assert.rejects(p.repo.upsertChunks(p.merchantId,sourceType,sourceId,[{...payload[0],metadata:publicMetadata}]),/public_business_namespace_owned_by_index_worker/);
        assert.deepEqual(await p.snapshot(),beforeReserved,'reserved metadata must fail before deletion or insertion');
        await p.repo.deleteBySource(p.merchantId,sourceType,sourceId);await kept();
        const after=await f.prisma.knowledgeChunk.findMany({where:{merchantId:p.merchantId,sourceType,sourceId}});
        assert.equal(after.filter(row=>row.metadata?.publicSourceNamespace!==namespace).length,0);
        assert.ok(after.some(row=>row.metadata?.publicSourceNamespace===namespace));
      }
    });
  }finally{await p.cleanup();}
}

export async function exerciseLegacyKnowledgeNamespaceJsonCases(t,f){await exercise(t,f,'json');}
export async function exerciseLegacyKnowledgeNamespacePgvectorCases(t,f){await exercise(t,f,'pgvector');}
