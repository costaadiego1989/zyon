import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { Prisma, type PrismaClient, type AiUsageEvent } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { PRISMA_CROSS_MERCHANT_CLIENT } from "../../shared/persistence/persistence.module.js";
import { REDIS_CLIENT_TOKEN } from "../../shared/cache/redis.module.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import { configureAiMetering, type AiMeteringContext } from "../../shared/ai-metering.js";
import { configureAiAutomation } from "../../shared/ai-automation.js";
import { AiGovernanceService } from "../ai-governance/ai-governance.service.js";
import { decimalMicros, estimateCost, normalizeUsage, object, providerName, ratesAt, type Usage, type Rates } from "./usage.js";

type Completion = { id: string; payload: { id?: string; model?: string; usage?: unknown }; status: string; endedAt: string };
const RETRY = "zyon:ai-metering:completions";
@Injectable()
export class AiMeteringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiMeteringService.name);
  private dispose?: () => void;
  private disposeAutomation?: () => void;
  private worker?: ReturnType<typeof setInterval>;
  private draining = false;
  constructor(@Inject(PRISMA_CROSS_MERCHANT_CLIENT) private readonly db: PrismaClient,
    private readonly tenant: TenantContextService, @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis | null,
    private readonly governance: AiGovernanceService) {}
  onModuleInit() {
    this.dispose = configureAiMetering(this, () => this.tenant.get()?.merchantId);
    this.disposeAutomation = configureAiAutomation(this.governance);
    this.worker = setInterval(() => { void this.drain(); }, 10_000); this.worker.unref();
  }
  onModuleDestroy() { this.dispose?.(); this.disposeAutomation?.(); clearInterval(this.worker); }

  async begin(context: AiMeteringContext, provider: string, model: string, credentialScope: string, channel = "chat", component = "text_generation", key?: string) {
    const identity = await this.governance.authorize(context, "model", provider + ":" + model);
    const merchant = await this.db.merchant.findUnique({ where: { id: context.merchantId }, select: { id: true, billingAccountMerchantId: true } });
    if (!merchant) throw new Error("ai_metering_company_not_found");
    const idempotencyKey = key ?? "attempt:" + randomUUID();
    const row = await this.db.aiUsageEvent.upsert({ where: { idempotencyKey }, create: {
      idempotencyKey, merchantId: merchant.id, billingAccountId: merchant.billingAccountMerchantId ?? merchant.id,
      credentialScope, payer: context.payer ?? "platform", source: context.source, channel, component, provider,
      actorId: identity.actorId, actorRole: identity.actorRole, teamId: identity.teamId, taskId: context.taskId,
      model, requestedModel: model, executionStatus: "unknown", measurementOrigin: channel === "voice" ? "server_sideband" : "server_http",
      costCenter: context.costCenter ?? (channel === "voice" ? "voice" : "text"), conversationId: context.conversationId, voiceSessionId: context.voiceSessionId,
      startedAt: new Date(), completedAt: new Date(), latencyMs: 0,
    }, update: {} });
    if (row.merchantId !== merchant.id) throw new Error("ai_metering_provider_identity_conflict");
    return row;
  }

  async fetch(context: AiMeteringContext, input: string | URL | Request, init?: RequestInit, transport: typeof fetch = globalThis.fetch): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === "string" ? object(JSON.parse(init.body)) : {};
    if (body.stream === true) throw new Error("ai_metering_stream_requires_usage_collector");
    const provider = providerName(url), headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const scope = credentialScope(provider, headers.get("authorization") ?? "local");
    const row = await this.begin(context, provider, String(body.model ?? "unknown"), scope, "chat", url.endsWith("/embeddings") ? "embedding" : "text_generation");
    let response: Response;
    try { response = await transport(input, init); }
    catch (error) { await this.completeSafely({ id: row.id, payload: {}, status: "unknown", endedAt: new Date().toISOString() }); throw error; }
    if (!response.ok) {
      await this.completeSafely({ id: row.id, payload: {}, status: response.status >= 400 && response.status < 500 ? "rejected" : "unknown", endedAt: new Date().toISOString() });
      return response;
    }
    let data: Record<string, any> = {};
    try { data = object(await response.clone().json()); } catch { /* Persisted attempt remains unknown. */ }
    const usage = data.usage_metadata ?? data.usage;
    await this.completeSafely({ id: row.id, payload: {
      ...(typeof data.id === "string" ? { id: data.id.slice(0, 200) } : {}),
      ...(typeof data.model === "string" ? { model: data.model.slice(0, 200) } : {}),
      usage: sanitizedUsage(usage),
    }, status: usage ? "succeeded" : "unknown", endedAt: new Date().toISOString() });
    return response;
  }

  async complete(input: Completion) {
    const row = await this.db.aiUsageEvent.findUnique({ where: { id: input.id } });
    if (!row || row.costStatus === "reconciled") return;
    const usage = normalizeUsage(input.payload, row.component === "embedding");
    // A delayed/replayed incomplete event must not erase a measured response.
    if(row.usageKnown&&!usage)return;
    const model = input.payload.model ?? row.model;
    let cost: bigint | undefined, audioCost: bigint | undefined, currency: string | undefined, version: string | undefined, costStatus = "unpriced";
    const reported = row.provider === "openrouter" ? decimalMicros(object(input.payload.usage).cost) : undefined;
    if(row.usageKnown&&row.providerEventId===input.payload.id&&usage?.input===row.promptTokens&&usage?.output===row.completionTokens
      &&(reported===undefined||reported===row.costMicros))return;
    if (reported !== undefined) { cost = reported; currency = "USD"; costStatus = "provider_reported"; }
    else if (usage) {
      const price = await this.db.aiPriceVersion.findFirst({ where: { provider: row.provider, model, channel: row.channel, component: row.component,
        effectiveFrom: { lte: row.startedAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: row.startedAt } }], rates: { not: Prisma.DbNull } }, orderBy: { effectiveFrom: "desc" } });
      if (price) {
        const rates = ratesAt(object(price.rates) as Rates,row.startedAt);
        cost = estimateCost(usage, rates);
        if (cost !== undefined) { currency = price.currency; version = price.version; costStatus = "estimated"; }
        if (row.channel === "voice" && row.component === "realtime_response") audioCost = estimateAudioCost(usage, rates);
      }
    }
    const endedAt = new Date(input.endedAt), providerId = input.payload.id;
    const key = providerId ? `provider:${row.provider}:${row.credentialScope}:${providerId}:${row.component}` : row.idempotencyKey;
    try {
      await this.db.aiUsageEvent.update({ where: { id: row.id }, data: { idempotencyKey: key, providerEventId: providerId, model,
        executionStatus: input.status, usageKnown: !!usage, promptTokens: usage?.input, completionTokens: usage?.output, totalTokens: usage?.total,
        inputDetails: usage?.inputDetails, outputDetails: usage?.outputDetails, costMicros: cost, audioCostMicros: audioCost,
        currency, pricingVersion: version, costStatus, completedAt: endedAt, latencyMs: Math.max(0, endedAt.getTime() - row.startedAt.getTime()),
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const prior = await this.db.aiUsageEvent.findUnique({ where: { idempotencyKey: key } });
      if (!prior || prior.merchantId !== row.merchantId || prior.model !== model) throw new Error("ai_metering_provider_identity_conflict");
      await this.db.aiUsageEvent.delete({ where: { id: row.id } });
    }
  }

  async completeSafely(completion: Completion) {
    for (let i = 0; i < 3; i++) { try { await this.complete(completion); return; } catch { if (i < 2) await new Promise(r => setTimeout(r, 75 * (i + 1))); } }
    try { if (!this.redis) throw new Error(); await this.redis.zadd(RETRY, Date.now(), JSON.stringify(completion)); }
    catch { this.logger.error("ai_metering_completion_unavailable: persisted attempt requires reconciliation"); }
    this.logger.error("ai_metering_completion_pending");
  }
  private async drain() {
    if (!this.redis || this.draining) return; this.draining = true;
    try {
      const entries = await this.redis.zrange(RETRY, 0, 19);
      for (const entry of entries) { try { await this.complete(JSON.parse(entry)); await this.redis.zrem(RETRY, entry); } catch { break; } }
    } catch { this.logger.error("ai_metering_retry_unavailable"); } finally { this.draining = false; }
  }
  async observeVoice(context: AiMeteringContext, scope: string, model: string, event: unknown, transcriptionModel?: string) {
    const e = object(event), response = object(e.response);
    const isResponse = ["response.done", "response.completed", "response.created"].includes(e.type) && typeof response.id === "string";
    const isTranscription = e.type === "conversation.item.input_audio_transcription.completed" && typeof e.item_id === "string";
    if (!isResponse && !isTranscription) return;
    const id = isResponse ? response.id : e.item_id;
    const component = isResponse ? "realtime_response" : "transcription";
    const row = await this.begin(context, "openai", isResponse ? model : transcriptionModel ?? "unknown", scope, "voice", component,
      `provider:openai:${scope}:${id}:${component}`);
    if (e.type === "response.created") return;
    await this.completeSafely({ id: row.id, payload: { id, model: isResponse ? model : transcriptionModel ?? "unknown", usage: sanitizedUsage(isResponse ? response.usage : e.usage) },
      status: isResponse ? response.status === "completed" ? "succeeded" : response.status === "failed" ? "failed" : "cancelled" : "succeeded", endedAt: new Date().toISOString() });
  }
  async openVoiceSession(input: { merchantId: string; conversationId: string }, model: string, apiKey: string, source: string) {
    const identity=await this.governance.authorize({...input,source},"model","openai:"+model);
    const merchant = await this.db.merchant.findUniqueOrThrow({ where: { id: input.merchantId }, select: { billingAccountMerchantId: true } });
    return this.db.aiVoiceUsageSession.create({ data: { id: randomUUID(), merchantId: input.merchantId, billingAccountId: merchant.billingAccountMerchantId ?? input.merchantId,
      conversationId: input.conversationId,actorId:identity.actorId,actorRole:identity.actorRole,teamId:identity.teamId,
      credentialScope: credentialScope("openai", "Bearer " + apiKey), model, source, state: "negotiating" } });
  }
  async authorizeVoiceTurn(context:AiMeteringContext,model:string) {
    await this.governance.authorize(context,"model","openai:"+model);
  }
  async voiceSessionState(id: string, state: string, providerCallId?: string) {
    await this.db.aiVoiceUsageSession.update({ where: { id }, data: { state, providerCallId, ...(["closed","unknown","unobservable","rejected"].includes(state) ? { closedAt: new Date() } : {}) } });
  }
  async rememberVoicePermit(token: string, context: AiMeteringContext) {
    if (!this.redis) throw new Error("voice_metering_correlation_unavailable");
    await this.redis.set("ai:metering:permit:" + credentialScope("permit",token),JSON.stringify(context),"EX",3600);
  }
  async voicePermitContext(token: string, merchantId: string, conversationId: string): Promise<AiMeteringContext> {
    const value = await this.redis?.get("ai:metering:permit:" + credentialScope("permit",token));
    if (!value) throw new Error("voice_metering_correlation_unavailable");
    const context = JSON.parse(value) as AiMeteringContext;
    if (context.merchantId !== merchantId || context.conversationId !== conversationId || context.costCenter !== "voice") throw new Error("voice_metering_correlation_mismatch");
    return context;
  }
}
export function credentialScope(provider: string, key: string) { return createHash("sha256").update(provider + ":" + key).digest("hex").slice(0, 24); }
function sanitizedUsage(value: unknown) {
  const u = object(value), out: Record<string, unknown> = {};
  for (const key of ["input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "cost"]) {
    if (typeof u[key] === "number" || typeof u[key] === "string") out[key] = u[key];
  }
  for (const key of ["input_token_details", "prompt_tokens_details", "output_token_details", "completion_tokens_details"]) {
    const d = object(u[key]), safe: Record<string, unknown> = {};
    for (const name of ["text_tokens", "audio_tokens", "image_tokens", "cached_tokens", "cache_read", "cache_creation", "cache_write_tokens", "reasoning_tokens", "reasoning"]) if (typeof d[name] === "number") safe[name] = d[name];
    if (d.cached_tokens_details) safe.cached_tokens_details = Object.fromEntries(["text_tokens", "audio_tokens", "image_tokens"].filter(k => typeof object(d.cached_tokens_details)[k] === "number").map(k => [k, d.cached_tokens_details[k]]));
    if (Object.keys(safe).length) out[key] = safe;
  }
  return Object.keys(out).length ? out : undefined;
}
function estimateAudioCost(usage: Usage, rates: Rates): bigint | undefined {
  const audio = usage.inputDetails.audio_tokens ?? 0, output = usage.outputDetails.audio_tokens ?? 0;
  const cached = usage.inputDetails.cached_audio_tokens ?? ((usage.inputDetails.cached_tokens ?? 0) === 0 ? 0 : undefined);
  if (cached === undefined || cached > audio) return;
  return estimateCost({ input: audio, output, total: audio + output, inputDetails: { text_tokens: 0, audio_tokens: audio, cached_tokens: cached, cached_text_tokens: 0, cached_audio_tokens: cached }, outputDetails: { text_tokens: 0, audio_tokens: output } }, rates);
}
