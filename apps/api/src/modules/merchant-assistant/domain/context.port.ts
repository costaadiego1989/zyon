import type { AssistantArtifact, AssistantContextDescriptor, AssistantCampaignProgress } from '@zyon/shared-types';
import type { AssistantScope } from './assistant.port.js';
import type { AssistantToolDescriptor } from './model.port.js';
import type { AssistantKnowledgeScope } from './knowledge.port.js';

export interface AssistantToolInput {
  scope: AssistantScope; threadId: string; turnId: string; leaseToken: string;
  name: string; args: Record<string, unknown>;
  /** Assigned by server orchestration, never a model argument or request body field. */
  origin?: 'model';
}
export interface AssistantToolResult { data: unknown; artifacts: AssistantArtifact[]; }
export interface UncitedAssistantResponse {
  suggestedReply:string; campaign:AssistantCampaignProgress|null;
  evidence:ReadonlyArray<{name:string;result:AssistantToolResult}>;
}
/** Only server composition registers contexts; neither model nor request chooses authority. */
export interface AssistantContextPort {
  readonly descriptor: AssistantContextDescriptor;
  readonly knowledgeScope: AssistantKnowledgeScope;
  authorize(scope: AssistantScope): Promise<void>;
  authorizeInvocation(scope: AssistantScope): Promise<void>;
  tools(): AssistantToolDescriptor[];
  execute(input: AssistantToolInput): Promise<AssistantToolResult>;
  /** Record explicit merchant answers before asking the next question; no model authority is accepted. */
  prepareTurn?(input:Pick<AssistantToolInput,'scope'|'threadId'|'turnId'|'leaseToken'>):Promise<AssistantToolResult|undefined>;
  /** Server-derived briefing status and data, never hidden model reasoning or approval. */
  checklist?(campaign:AssistantCampaignProgress|null):Record<string,unknown>;
  /** Server-rendered questions/facts only; untrusted model prose cannot establish evidence. */
  uncitedResponse?(input:UncitedAssistantResponse):string|null;
  /** Context-owned clarification, also applied to cited campaign questionnaires. No actions. */
  guidedResponse?(input:UncitedAssistantResponse & {message:string}):string|null;
  /** Known malformed model reply only. Canonical questions/read facts, never tool replay. */
  recoveredResponse?(input:UncitedAssistantResponse & {message:string}):string|null;
}
