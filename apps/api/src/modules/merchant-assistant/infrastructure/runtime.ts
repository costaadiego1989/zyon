import type { PrismaClient } from '@prisma/client';
import type { TenantContextService } from '../../../shared/tenant/tenant-context.service.js';
import type { AiGovernanceService } from '../../ai-governance/ai-governance.service.js';
import { object, ratesAt } from '../../ai-metering/usage.js';
import type { MerchantStoreRepository } from '../../merchant/domain/ports/merchant-store.repository.port.js';
import { AssistantError, validateAssistantScope, type AssistantScope } from '../domain/assistant.port.js';
import type { AssistantTokenRates } from '../domain/model.port.js';
import { AssistantContextRegistry } from '../application/assistant-context.registry.js';
import { AssistantApiService } from '../application/assistant-api.service.js';
import { AssistantService } from '../application/assistant.service.js';
import { TurnAdmissionService } from '../application/turn-admission.service.js';
import { AssistantKnowledgeRetriever } from './assistant-knowledge.retriever.js';
import { PrismaAssistantRepository } from './prisma-assistant.repository.js';
import { MerchantAiGateway } from './merchant-ai.gateway.js';
import { AssistantWorker } from './assistant.worker.js';

interface Dependencies {
  prisma: PrismaClient; memberships: Pick<MerchantStoreRepository, 'findMembership'>;
  tenant: TenantContextService; governance: Pick<AiGovernanceService, 'authorize'>;
  env: Record<string, string | undefined>; transport?: typeof fetch; clock?: () => Date;
}
const budget = (raw: string | undefined, fallback: bigint) => {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d{0,18}$/.test(raw) || BigInt(raw) > 9223372036854775807n) throw new AssistantError('assistant_ai_budget_invalid', 503);
  return BigInt(raw);
};
function configuration(env: Dependencies['env']) {
  if (env.OPENROUTER_API_KEY) return { apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || 'openai/gpt-4o-mini', baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1' };
  if (env.OPENAI_API_KEY) return { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4o-mini', baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1' };
  return { apiKey: env.DEEPSEEK_API_KEY || '', model: env.DEEPSEEK_MODEL || 'deepseek-chat', baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1' };
}
/** Lazy composition. Constructing this runtime performs no AI, Meta, billing or SQL operation. */
export function createMerchantAssistantRuntime(deps: Dependencies) {
  const clock = deps.clock ?? (() => new Date());
  const enabled = () => deps.env.MERCHANT_ASSISTANT_ENABLED === 'true';
  const repo = new PrismaAssistantRepository(deps.prisma, clock);
  const contexts = new AssistantContextRegistry();
  const knowledge = new AssistantKnowledgeRetriever(undefined, clock);
  const membership = async (scope: AssistantScope) => {
    validateAssistantScope(scope);
    const member = await deps.memberships.findMembership(scope.actorId, scope.merchantId);
    if (!member || member.merchantId !== scope.merchantId || !['owner', 'admin'].includes(member.role)) throw new AssistantError('assistant_forbidden', 403);
    return member;
  };
  const authorizeActor = async (scope: AssistantScope) => { await membership(scope); };
  const asActor = async <T>(scope: AssistantScope, work: () => Promise<T>): Promise<T> => {
    const member = await membership(scope);
    return deps.tenant.run({ merchantId: scope.merchantId, userId: scope.actorId, role: member.role }, work);
  };
  const authorizeTool = async (scope: AssistantScope, resource: string) => {
    await asActor(scope, () => deps.governance.authorize({ merchantId: scope.merchantId, source: 'merchant_assistant' }, 'tool', resource));
  };
  const admission = new TurnAdmissionService(repo, async scope => {
    if (!enabled()) throw new AssistantError('assistant_unavailable', 503);
    await (await contexts.resolve(scope)).authorizeInvocation(scope);
  }, () => ({ turnMicros: budget(deps.env.MERCHANT_ASSISTANT_TURN_BUDGET_MICROS, 50000n), monthlyMicros: budget(deps.env.MERCHANT_ASSISTANT_MONTHLY_BUDGET_MICROS, 2000000n) }), clock);
  const rates = async (provider: string, model: string): Promise<AssistantTokenRates | null> => {
    const now = clock();
    const price = await deps.prisma.aiPriceVersion.findFirst({ where: { provider, model, channel: 'chat', component: 'text_generation', currency: 'USD', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' }, select: { rates: true, inputMicrosPerMillion: true, outputMicrosPerMillion: true } });
    if (!price) return null;
    const current = ratesAt(object(price.rates), now);
    const read = (key: string, fallback?: bigint | null) => current[key] === undefined ? fallback ?? undefined : /^\d{1,19}$/.test(current[key]) ? BigInt(current[key]) : undefined;
    const input = read('input', price.inputMicrosPerMillion), output = read('output', price.outputMicrosPerMillion);
    if (input === undefined || output === undefined || input < 0n || output < 0n) return null;
    return { inputMicrosPerMillion: input, outputMicrosPerMillion: output,
      ...(read('cached') === undefined ? {} : { cachedMicrosPerMillion: read('cached') }), ...(read('cache_write') === undefined ? {} : { cacheWriteMicrosPerMillion: read('cache_write') }) };
  };
  const gateway = new MerchantAiGateway({ repo, admission, config: () => configuration(deps.env), clock, rates, transport: deps.transport,
    authorizeModel: async (scope, resource) => { await asActor(scope, () => deps.governance.authorize({ merchantId: scope.merchantId, source: 'merchant_assistant' }, 'model', resource)); } });
  const worker = new AssistantWorker({ repo, admission, clock, enabled: enabled(), respond: async input => {
    if (!enabled()) throw new AssistantError('assistant_unavailable', 503);
    const context = await contexts.resolve(input.scope);
    return asActor(input.scope, () => new AssistantService({ repo, context, knowledge, model: gateway, clock }).respond(input));
  } });
  const api = new AssistantApiService({ repo, context: scope => contexts.resolve(scope), admission, knowledge, enabled,
    dashboardUrl: deps.env.META_ADS_DASHBOARD_URL || deps.env.DASHBOARD_URL || '', wake: () => { queueMicrotask(() => { void worker.drain(); }); } });
  return { repo, contexts, knowledge, admission, gateway, worker, api, authorizeActor, authorizeTool, asActor };
}
export type MerchantAssistantRuntime = ReturnType<typeof createMerchantAssistantRuntime>;
