import { AssistantError, validateAssistantScope, type AssistantScope } from '../domain/assistant.port.js';
import type { AssistantContextPort } from '../domain/context.port.js';

/** Registration is a server capability, never a tool exposed to the model. */
export class AssistantContextRegistry {
  private readonly contexts = new Map<string, AssistantContextPort>();
  has(id: string): boolean { return this.contexts.has(id); }
  ids(): string[] { return [...this.contexts.keys()]; }
  register(context: AssistantContextPort): void {
    if (this.contexts.has(context.descriptor.id)) throw new AssistantError('assistant_context_duplicate', 409);
    this.contexts.set(context.descriptor.id, context);
  }
  async resolve(scope: AssistantScope): Promise<AssistantContextPort> {
    validateAssistantScope(scope);
    const context = this.contexts.get(scope.context);
    if (!context) throw new AssistantError('assistant_context_unavailable', 403);
    return context;
  }
}
