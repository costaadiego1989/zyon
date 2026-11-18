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
export function merchantAssistantModelConfiguration(env: Dependencies['env']) {
  const selected = env.MERCHANT_ASSISTANT_PROVIDER;
  if (selected !== undefined && !['deepseek', 'openai', 'openrouter'].includes(selected)) throw new AssistantError('assistant_provider_invalid', 503);
  const provider = selected ?? (env.OPENROUTER_API_KEY ? 'openrouter' : env.OPENAI_API_KEY ? 'openai' : 'deepseek');
  if (provider === 'openrouter') return { apiKey: env.OPENROUTER_API_KEY || '', model: env.MERCHANT_ASSISTANT_MODEL || env.OPENROUTER_MODEL || 'openai/gpt-4o-mini', baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1' };
  if (provider === 'openai') return { apiKey: env.OPENAI_API_KEY || '', model: env.MERCHANT_ASSISTANT_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini', baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1' };
  return { apiKey: env.DEEPSEEK_API_KEY || '', model: env.MERCHANT_ASSISTANT_MODEL || env.DEEPSEEK_MODEL || 'deepseek-flash', baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1' };
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
  const gateway = new MerchantAiGateway({ repo, admission, config: () => merchantAssistantModelConfiguration(deps.env), clock, rates, transport: deps.transport,
    authorizeModel: async (scope, resource) => { await asActor(scope, () => deps.governance.authorize({ merchantId: scope.merchantId, source: 'merchant_assistant' }, 'model', resource)); } });
  const worker = new AssistantWorker({ repo, admission, clock, enabled: enabled(), contexts: () => contexts.ids(), accepts: scope => contexts.has(scope.context), respond: async input => {
    if (!enabled()) throw new AssistantError('assistant_unavailable', 503);
    const context = await contexts.resolve(input.scope);
    return asActor(input.scope, () => new AssistantService({ repo, context, knowledge, model: gateway, clock }).respond(input));
  } });
  const api = new AssistantApiService({ repo, context: scope => contexts.resolve(scope), admission, knowledge, enabled,
    dashboardUrl: deps.env.META_ADS_DASHBOARD_URL || deps.env.DASHBOARD_URL || '', wake: () => { queueMicrotask(() => { void worker.drain(); }); } });
  const createDailyAnalysis = (authorizeStore: (merchantId: string) => Promise<void>) => {
    const authorize = async (scope: AssistantScope) => {
      validateAssistantScope(scope);
      if (scope.actorId !== 'service:meta-ads-agent' || !/^meta-ads-daily:[a-f0-9]{64}$/.test(scope.context)) throw new AssistantError('assistant_forbidden', 403);
      await authorizeStore(scope.merchantId);
    };
    const asService = async <T>(scope: AssistantScope, work: () => Promise<T>): Promise<T> => {
      await authorize(scope); return deps.tenant.run({ merchantId: scope.merchantId, userId: scope.actorId, role: 'service' }, work);
    };
    const dailyAdmission = new TurnAdmissionService(repo, authorize,
      () => ({ turnMicros: budget(deps.env.MERCHANT_ASSISTANT_TURN_BUDGET_MICROS, 50000n), monthlyMicros: budget(deps.env.MERCHANT_ASSISTANT_MONTHLY_BUDGET_MICROS, 2000000n) }), clock);
    const model = new MerchantAiGateway({ repo, admission: dailyAdmission, config: () => merchantAssistantModelConfiguration(deps.env), clock, rates, transport: deps.transport,
      authorizeModel: async (scope, resource) => { await asService(scope, () => deps.governance.authorize({ merchantId: scope.merchantId, source: 'meta_ads_daily_analysis' }, 'model', resource)); } });
    return { repo, admission: dailyAdmission, model, authorize, asService, clock };
  };
  return { repo, contexts, knowledge, admission, gateway, worker, api, authorizeActor, authorizeTool, asActor, createDailyAnalysis };
}
export type MerchantAssistantRuntime = ReturnType<typeof createMerchantAssistantRuntime>;
