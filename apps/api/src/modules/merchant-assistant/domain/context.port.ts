import type { AssistantArtifact, AssistantContextDescriptor } from '@zyon/shared-types';
import type { AssistantScope } from './assistant.port.js';
import type { AssistantToolDescriptor } from './model.port.js';

export interface AssistantToolInput {
  scope: AssistantScope; threadId: string; turnId: string; leaseToken: string;
  name: string; args: Record<string, unknown>;
}
export interface AssistantToolResult { data: unknown; artifacts: AssistantArtifact[]; }
/** Only server composition registers contexts; neither model nor request chooses authority. */
export interface AssistantContextPort {
  readonly descriptor: AssistantContextDescriptor;
  authorize(scope: AssistantScope): Promise<void>;
  authorizeInvocation(scope: AssistantScope): Promise<void>;
  tools(): AssistantToolDescriptor[];
  execute(input: AssistantToolInput): Promise<AssistantToolResult>;
}
