import type {AssistantReference} from '@zyon/shared-types';

export interface AssistantKnowledgeDocument {
  id:string;version:string;title:string;context:string;audience:'merchant'|'buyer';
  published:boolean;reviewedAt:string;validFrom:string;validUntil:string|null;url:string;
  externalSources:readonly {title:string;url:string}[];
  sections:readonly {id:string;keywords:readonly string[];content:string}[];
}
export interface AssistantKnowledgeScope {context:string;audience:'merchant'|'buyer';}
export interface RetrievedAssistantKnowledge {reference:AssistantReference;content:string;score:number;}
export interface AssistantKnowledgePort {
  retrieve(scope:AssistantKnowledgeScope,query:string):Promise<RetrievedAssistantKnowledge[]>;
  validateReferences(scope:AssistantKnowledgeScope,ids:readonly string[],retrieved:readonly RetrievedAssistantKnowledge[]):Promise<AssistantReference[]>;
  source(scope:AssistantKnowledgeScope,id:string):Promise<AssistantKnowledgeDocument|null>;
}
