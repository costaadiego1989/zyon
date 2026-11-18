import type { AssistantArtifact, AssistantReference } from '@zyon/shared-types';
import { AssistantError, type AssistantRepository } from '../domain/assistant.port.js';
import type { AssistantContextPort, AssistantToolInput, UncitedAssistantResponse } from '../domain/context.port.js';
import { CASHBACK_KNOWLEDGE_FALLBACK_NOTICE, type AssistantKnowledgePort, type RetrievedAssistantKnowledge } from '../domain/knowledge.port.js';
import type { AssistantModelMessage, AssistantModelPort } from '../domain/model.port.js';
import { assertAssistantTurnLease } from './turn-admission.service.js';

interface Dependencies { repo: AssistantRepository; context: AssistantContextPort; knowledge: AssistantKnowledgePort; model: AssistantModelPort; clock?: () => Date; }
export interface AssistantResponse { reply: string; references: AssistantReference[]; artifacts: AssistantArtifact[]; }
export type AssistantResponseInput = Pick<AssistantToolInput, 'scope' | 'threadId' | 'turnId' | 'leaseToken'>;
const unavailable = 'Não encontrei evidência suficiente nas fontes vigentes para confirmar essa informação. Posso ajudar a verificar os dados da loja ou você pode tentar novamente mais tarde.';
const safeCode = (error: unknown) => {
  const value = error as { code?: unknown; status?: unknown };
  return typeof value?.code === 'string' && /^(assistant_|campaign_|creative_|image_|generation_|proposal_|approval_|addon_|meta_)[a-z0-9_]{1,100}$/.test(value.code) ? value.code : 'assistant_tool_failed';
};
function toolContent(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') <= 10000) return json;
  // Large descriptions/media stay canonical in artifacts and persistence, not in model history.
  return JSON.stringify({ truncated: true, content: json.slice(0, 4500), note: 'Consulte o artefato canônico. Conteúdo truncado não comprova campos omitidos.' });
}

export class AssistantService {
  private readonly clock: () => Date;
  constructor(private readonly deps: Dependencies) { this.clock = deps.clock ?? (() => new Date()); }
  private async current(input: AssistantResponseInput) {
    await this.deps.context.authorizeInvocation(input.scope);
    return this.deps.repo.atomic(input.scope, input.threadId, async tx => {
      const turn = await tx.turn(input.turnId); assertAssistantTurnLease(turn, input.leaseToken, this.clock());
      return { turn, thread: structuredClone(tx.thread) };
    });
  }
  async respond(input: AssistantResponseInput): Promise<AssistantResponse> {
    const initial = await this.current(input);
    const history = (await this.deps.repo.turns(input.scope, input.threadId, { limit: 12 })).turns
      .filter(t => t.ordinal < initial.turn.ordinal && t.status === 'completed').slice(-4);
    const messages: AssistantModelMessage[] = history.flatMap(t => [{ role: 'user' as const, content: t.message.slice(0, 1800) }, ...(t.reply ? [{ role: 'assistant' as const, content: t.reply.slice(0, 1800) }] : [])]);
    messages.push({ role: 'user', content: initial.turn.message });
    let knowledge: RetrievedAssistantKnowledge[];
    const knowledgeScope=Object.freeze({...this.deps.context.knowledgeScope,merchantId:input.scope.merchantId});
    let fallback=knowledgeScope.context==='cashback';
    try {
      if(this.deps.knowledge.retrieveWithStatus){
        const retrieved=await this.deps.knowledge.retrieveWithStatus(knowledgeScope,initial.turn.message);
        knowledge=retrieved.entries;fallback=knowledgeScope.context==='cashback'&&retrieved.status!=='graph_used';
      }else knowledge=await this.deps.knowledge.retrieve(knowledgeScope,initial.turn.message);
    } catch { knowledge = []; }
    const visibleReply=(reply:string)=>fallback?`${CASHBACK_KNOWLEDGE_FALLBACK_NOTICE}\n\n${reply}`:reply;
    const tools = this.deps.context.tools(); const artifacts: AssistantArtifact[] = []; const evidence:UncitedAssistantResponse['evidence'][number][]=[];
    for (let round = 0; round <= 5; round++) {
      const state = await this.current(input);
      const response = await this.deps.model.complete({ ...input, step: round, messages: structuredClone(messages), knowledge, tools,
        state: { contextLabel: this.deps.context.descriptor.label, now: this.clock().toISOString(), campaign: state.thread.campaignProgress } });
      if (response.toolCalls.length) {
        if (round === 5) throw new AssistantError('assistant_tool_round_limit', 429);
        if (response.toolCalls.length > 5 || response.toolCalls.some(call => !tools.some(t => t.name === call.name))) throw new AssistantError('assistant_tool_forbidden', 403);
        messages.push({ role: 'assistant', content: '', tool_calls: response.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) });
        for (const call of response.toolCalls) {
          await this.current(input);
          try {
            const resolved = await this.deps.context.execute({ ...input, name: call.name, args: call.args });
            evidence.push({name:call.name,result:resolved});
            artifacts.push(...resolved.artifacts);
            messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent(resolved.data) });
          } catch (error) {
            const code = safeCode(error);
            if (['assistant_forbidden', 'assistant_lease_lost', 'assistant_context_unavailable', 'assistant_outcome_unknown', 'assistant_operation_already_dispatched'].includes(code) || (error as { status?: number })?.status === 403 && code !== 'approval_required') throw error;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: code, completed: false }) });
          }
        }
        continue;
      }
      const current=await this.current(input);
      if (!response.reply?.trim()) throw new AssistantError('assistant_model_response_invalid', 502);
      let references: AssistantReference[];
      try { references = await this.deps.knowledge.validateReferences(knowledgeScope, response.referenceIds, knowledge); }
      catch { return { reply: visibleReply(unavailable), references: [], artifacts: this.latestArtifacts(artifacts) }; }
      const guided=this.deps.context.guidedResponse?.({message:initial.turn.message,suggestedReply:response.reply,campaign:current.thread.campaignProgress,evidence});
      if(guided)return {reply:visibleReply(guided),references:[],artifacts:this.latestArtifacts(artifacts)};
      // A question mark or unrelated tool result never validates model-written claims.
      // Without citations the context may emit only its own canonical facts/questions.
      let canonical:string|null=/^como posso ajudar\?$/i.test(response.reply.trim())?'Como posso ajudar?':null;
      if(!references.length&&!canonical){try{canonical=this.deps.context.uncitedResponse?.({suggestedReply:response.reply,campaign:current.thread.campaignProgress,evidence})??null;}catch{canonical=null;}}
      return { reply: visibleReply(references.length ? response.reply : canonical??unavailable), references, artifacts: this.latestArtifacts(artifacts) };
    }
    throw new AssistantError('assistant_tool_round_limit', 429);
  }
  private latestArtifacts(artifacts: AssistantArtifact[]): AssistantArtifact[] {
    const unique = new Map<string, AssistantArtifact>();
    for (const artifact of artifacts) {
      const id = artifact.type === 'campaign' ? artifact.campaign.id : artifact.type === 'generation' ? artifact.generation.id : artifact.type === 'proposal' ? artifact.proposal.id : '';
      unique.set(`${artifact.type}:${id}`, artifact);
    }
    return [...unique.values()];
  }
}
