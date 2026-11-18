import type { AssistantThread, AssistantTurn, AssistantTurnInput } from '@zyon/shared-types';
import { AssistantError, type AssistantRepository, type AssistantScope, type StoredAssistantTurn } from '../domain/assistant.port.js';
import type { AssistantContextPort } from '../domain/context.port.js';
import type { AssistantKnowledgePort } from '../domain/knowledge.port.js';
import type { TurnAdmissionService } from './turn-admission.service.js';

interface Dependencies {
  repo: AssistantRepository; context: (scope: AssistantScope) => Promise<AssistantContextPort>;
  admission: TurnAdmissionService; knowledge: AssistantKnowledgePort;
  enabled: () => boolean; dashboardUrl: string; wake: () => void;
}
export function publicAssistantTurn(turn: StoredAssistantTurn): AssistantTurn {
  return { id: turn.id, threadId: turn.threadId, ordinal: turn.ordinal, status: turn.status, message: turn.message, reply: turn.reply,
    references: turn.references, artifacts: turn.artifacts, error: turn.error, createdAt: turn.createdAt, updatedAt: turn.updatedAt };
}
export class AssistantApiService {
  constructor(private readonly deps: Dependencies) {}
  get dashboardUrl(): string { return this.deps.dashboardUrl; }
  private async context(scope: AssistantScope) {
    if (!this.deps.enabled()) throw new AssistantError('assistant_unavailable', 503);
    const context = await this.deps.context(scope); await context.authorize(scope); return context;
  }
  async thread(scope: AssistantScope): Promise<AssistantThread> {
    const context = await this.context(scope); const thread = await this.deps.repo.createThread(scope);
    return this.page(scope, thread.id, {}, context);
  }
  async page(scope: AssistantScope, id: string, page: { limit?: number; before?: number } = {}, authorized?: AssistantContextPort): Promise<AssistantThread> {
    const context = authorized ?? await this.context(scope);
    const thread = await this.deps.repo.readThread(scope, id); const history = await this.deps.repo.turns(scope, id, page);
    return { id: thread.id, context: context.descriptor, revision: thread.revision, campaign: thread.campaignProgress,
      turns: history.turns.map(publicAssistantTurn), nextCursor: history.nextCursor, updatedAt: thread.updatedAt };
  }
  async submit(scope: AssistantScope, id: string, input: AssistantTurnInput) {
    const context = await this.context(scope); await context.authorizeInvocation(scope);
    const admitted = await this.deps.admission.submit(scope, id, input);
    if (admitted.turn.status === 'queued') { try { this.deps.wake(); } catch { /* Persisted queue is also polled by the worker. */ } }
    return { turn: publicAssistantTurn(admitted.turn), revision: admitted.revision, replayed: admitted.replayed };
  }
  async source(scope: AssistantScope, id: string) {
    const context = await this.context(scope);
    if (typeof id !== 'string' || id.length > 201) throw new AssistantError('assistant_source_not_found', 404);
    const source = await this.deps.knowledge.source(context.knowledgeScope, id);
    if (!source) throw new AssistantError('assistant_source_not_found', 404);
    return source;
  }
}
