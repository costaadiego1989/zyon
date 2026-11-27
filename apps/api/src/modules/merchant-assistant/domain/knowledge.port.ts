import type {AssistantReference} from '@zyon/shared-types';

export interface AssistantKnowledgeDocument {
  id:string;version:string;title:string;context:string;audience:'merchant'|'buyer';
  published:boolean;reviewedAt:string;validFrom:string;validUntil:string|null;url:string;
  externalSources:readonly {title:string;url:string}[];
  sections:readonly {id:string;keywords:readonly string[];content:string}[];
}
export interface AssistantKnowledgeScope {context:string;audience:'merchant'|'buyer';merchantId?:string;}
export interface RetrievedAssistantKnowledge {reference:AssistantReference;content:string;score:number;}
export interface AssistantKnowledgeRetrieval {
  readonly status:'lexical'|'graph_used'|'reviewed_fallback'|'unavailable';
  readonly entries:RetrievedAssistantKnowledge[];readonly reason?:string;
}
export const CASHBACK_KNOWLEDGE_FALLBACK_NOTICE='A busca contextual está indisponível. Consultei somente a ajuda revisada de cashback.';
export interface AssistantKnowledgePort {
  retrieve(scope:AssistantKnowledgeScope,query:string):Promise<RetrievedAssistantKnowledge[]>;
  retrieveWithStatus?(scope:AssistantKnowledgeScope,query:string):Promise<AssistantKnowledgeRetrieval>;
  validateReferences(scope:AssistantKnowledgeScope,ids:readonly string[],retrieved:readonly RetrievedAssistantKnowledge[]):Promise<AssistantReference[]>;
  source(scope:AssistantKnowledgeScope,id:string):Promise<AssistantKnowledgeDocument|null>;
}
