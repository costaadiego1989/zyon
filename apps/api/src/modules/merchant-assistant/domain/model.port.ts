import type {AssistantScope} from './assistant.port.js';
import type {RetrievedAssistantKnowledge} from './knowledge.port.js';
import type {AssistantCampaignProgress} from '@zyon/shared-types';

export interface AssistantModelMessage {
  role:'user'|'assistant'|'tool';content:string;tool_call_id?:string;
  tool_calls?:Array<{id:string;type:'function';function:{name:string;arguments:string}}>;
}
export interface AssistantToolDescriptor {name:string;description:string;inputSchema:Record<string,unknown>;}
export interface AssistantModelInput {
  scope:AssistantScope;threadId:string;turnId:string;leaseToken:string;
  messages:AssistantModelMessage[];knowledge:RetrievedAssistantKnowledge[];tools:AssistantToolDescriptor[];
  state?:{contextLabel:string;now:string;campaign:AssistantCampaignProgress|null;checklist?:Record<string,unknown>};
  /** Server-selected orchestration step, scoped to this durable turn. */
  step?:number;
  /** Server-only purpose. Never taken from a merchant tool argument. */
  purpose?:'chat'|'daily_analysis';
}
export interface AssistantModelUsage { provider:string;model:string;inputTokens:number;cachedInputTokens:number|null;outputTokens:number; }
export interface AssistantModelResult {
  reply:string|null;referenceIds:string[];
  toolCalls:Array<{id:string;name:string;args:Record<string,unknown>}>;
  providerRequestId:string|null;costMicros:bigint;
  usage?:AssistantModelUsage;
}
export interface AssistantModelPort {complete(input:AssistantModelInput):Promise<AssistantModelResult>;}
export interface AssistantTokenRates {
  inputMicrosPerMillion:bigint;outputMicrosPerMillion:bigint;
  cachedMicrosPerMillion?:bigint;cacheWriteMicrosPerMillion?:bigint;
}
