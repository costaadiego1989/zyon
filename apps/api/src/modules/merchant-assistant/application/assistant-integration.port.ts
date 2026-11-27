import type { AssistantRepository, AssistantScope } from '../domain/assistant.port.js';
import type { AssistantContextPort } from '../domain/context.port.js';
import type { AssistantModelPort } from '../domain/model.port.js';
import type { TurnAdmissionService } from './turn-admission.service.js';

/** Server composition contract; no consumer depends on the assistant's infrastructure factory. */
export interface MerchantAssistantIntegrationPort {
  repo: AssistantRepository;
  contexts: { register(context: AssistantContextPort): void };
  authorizeActor(scope: AssistantScope): Promise<void>;
  authorizeTool(scope: AssistantScope, name: string): Promise<void>;
  createOpportunityPlanning(authorizeStore: (merchantId: string) => Promise<void>): ReturnType<MerchantAssistantIntegrationPort['createDailyAnalysis']>;
  createDailyAnalysis(authorizeStore: (merchantId: string) => Promise<void>): {
    repo: AssistantRepository; admission: TurnAdmissionService; model: AssistantModelPort;
    authorize(scope: AssistantScope): Promise<void>;
    asService<T>(scope: AssistantScope, work: () => Promise<T>): Promise<T>;
    clock: () => Date;
  };
}
