import {registerBusinessEvidenceRevalidationNative} from './service-business-revalidation-native.mjs';

registerBusinessEvidenceRevalidationNative(async({prisma,tenant,legacyRepository,graph,publicEmbedding,legacyEmbedding})=>{
  const {RevalidatePublicSourceService}=await import('../dist/modules/knowledge-base/application/use-cases/revalidate-public-source.service.js');
  const {PrismaPublicEvidenceSources}=await import('../dist/modules/knowledge-base/infrastructure/prisma-public-evidence.sources.js');
  const {QueryKnowledgeUseCase}=await import('../dist/modules/knowledge-base/application/use-cases/query-knowledge.use-case.js');
  const {GraphKnowledgeReader}=await import('../dist/modules/knowledge-base/infrastructure/graph-knowledge.reader.js');
  const {PublishedGraphKnowledgeSources}=await import('../dist/modules/knowledge-base/infrastructure/published-graph-knowledge.sources.js');
  const {PrismaPolicyRepository}=await import('../dist/modules/knowledge-base/infrastructure/repositories/prisma-policy.repository.js');
  const {parsePublicSupportFaqItems}=await import('../dist/modules/support/public-support-knowledge.module.js');
  const {GraphRetrievalService}=await import('../dist/modules/graph-rag/application/graph-retrieval.service.js');
  const {compileGraphRead}=await import('../dist/modules/graph-rag/domain/graph-query.js');
  const {admitGraphRows}=await import('../dist/modules/graph-rag/domain/graph-result.js');
  const neo4j=(await import('neo4j-driver')).default;
  const validator=new RevalidatePublicSourceService(new PrismaPublicEvidenceSources(prisma,tenant));
  const sources=new PublishedGraphKnowledgeSources(new PrismaPolicyRepository(prisma),{snapshot:async merchantId=>{
    const setting=await prisma.supportSetting.findUnique({where:{merchantId},select:{faqItems:true,updatedAt:true}});
    return{merchantId,version:setting?.updatedAt.getTime()??0,items:parsePublicSupportFaqItems(setting?.faqItems)};
  }});
  return{
    revalidate:input=>validator.revalidate(input),
    queryLegacy:async({graphState,...input})=>{
      // Controlled transport availability, real existing compiler/result admission
      // and actual local Neo4j read. This is not new-corpus T70 gateway proof.
      const retrieval=new GraphRetrievalService({enabled:graphState!=='disabled',merchantIds:[input.merchantId],
        timeoutMs:2500,maxAgeMs:300000,threshold:0.1},publicEmbedding,{read:async request=>{
        if(graphState==='unavailable')return{status:'unavailable',reason:'neo4j_unavailable'};
        const command=compileGraphRead(request),parameters={...command.parameters,
          limit:neo4j.int(command.parameters.limit),scanLimit:neo4j.int(command.parameters.scanLimit)};
        const rows=(await graph.query(command.text,parameters)).map(row=>Object.fromEntries(Object.entries(row)
          .map(([key,value])=>[key,neo4j.isInt(value)?value.inSafeRange()?value.toNumber():NaN:value])));
        return admitGraphRows(request,rows);
      }});
      return new QueryKnowledgeUseCase(legacyEmbedding,legacyRepository,undefined,new GraphKnowledgeReader(retrieval,sources),validator).execute(input);
    },
  };
});
