import type { ProductRepositoryPort } from '../../../catalog/domain/ports/product-repository.port.js';
import type { MerchantRepository } from '../../../merchant/domain/ports/merchant-repository.port.js';
import type { PaymentPlatformRepository } from '../../../payment/domain/ports/payment-platform-repository.port.js';
import type { WhatsAppConfigRepository } from '../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js';
import { ProductEntity } from '../../../catalog/domain/entities/product.entity.js';
import { TenantContextService } from '../../../../shared/tenant/tenant-context.service.js';
import { createMerchantAssistantRuntime } from '../../../merchant-assistant/infrastructure/runtime.js';
import { metaAssistantFixture } from '../../application/__tests__/assistant-fixture.js';
import { createMetaAdsRuntime } from '../runtime.js';
import {installCampaignApprovalSchema} from './campaign-approval-database.js';
import {PrismaMerchantStoreRepository} from '../../../merchant/infrastructure/prisma-merchant-store.repository.js';

export async function agenticRuntimeFixture(flags: Record<string, string | undefined> = {}, options:{minimumDailyBudgetCents?:number;opportunityModel?:boolean}={}) {
  const f = await metaAssistantFixture(); await f.connect(); f.setNow('2026-11-16T12:00:00Z');
  // This composition fixture starts with no chat; the base helper seeds an unrelated adapter turn.
  await f.sql.query('DELETE FROM merchant_assistant_threads WHERE id=$1', [f.thread.id]);
  await installCampaignApprovalSchema(f.sql);
  await f.sql.query(`
    ALTER TABLE merchants ADD COLUMN billing_account_merchant_id TEXT;
    CREATE TABLE merchant_users(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,email TEXT NOT NULL UNIQUE,password_hash TEXT,role TEXT NOT NULL,auth_version INTEGER NOT NULL DEFAULT 0,disabled_at TIMESTAMPTZ,oauth_provider TEXT,oauth_provider_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TYPE "MerchantRole" AS ENUM ('OWNER','ADMIN','STAFF');
    CREATE TABLE merchant_team_members(id TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,role "MerchantRole" NOT NULL,invited_by TEXT,joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(merchant_id,user_id));
    CREATE TABLE merchant_auth_sessions(id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,merchant_id TEXT NOT NULL,auth_version INTEGER NOT NULL,refresh_expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO merchant_users(id,merchant_id,email,role) VALUES ('owner-a','store-a','owner-a@example.test','owner'),('admin-a','store-a','admin-a@example.test','admin'),('staff-a','store-a','staff-a@example.test','staff'),('owner-b','store-b','owner-b@example.test','owner');
    INSERT INTO merchant_team_members(id,merchant_id,user_id,role) SELECT id||'-membership',merchant_id,id,upper(role)::"MerchantRole" FROM merchant_users;
  `);
  const tenant = new TenantContextService(); let role = true, aiCalls = 0; const writes: string[] = [], requests: string[] = [], identities: Array<{ userId: string; role: string; source: string }> = [];const deniedTools=new Set<string>();
  const canonicalMemberships=new PrismaMerchantStoreRepository(f.prisma);
  const memberships = { findMembership: async (actor: string, merchant: string) => role ? canonicalMemberships.findMembership(actor,merchant) : undefined };
  const env = { META_ADS_AGENT_ENABLED: 'true', MERCHANT_ASSISTANT_ENABLED: 'true', META_ADS_AGENT_AUTOMATION_ENABLED: 'true', META_ADS_AGENT_OBSERVATION_ENABLED: 'true', META_ADS_AGENT_REMOTE_WRITES_ENABLED: 'true', META_ADS_GRAPH_API_VERSION: 'v26.0', META_ADS_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), META_ADS_DASHBOARD_URL: 'https://dashboard.example.test', STOREFRONT_PUBLIC_URL: 'https://store.example.test', OPENAI_API_KEY: 'synthetic-provider-key', OPENAI_MODEL: 'gpt-4o-mini',META_ADS_IMAGE_SOURCE_HOSTS:'media.example.test', ...flags };
  const transport: typeof fetch = async (url, init) => {
    requests.push(String(url));
    if (String(url) === 'https://api.openai.com/v1/chat/completions') { aiCalls++; return new Response(JSON.stringify({ id: 'runtime-ai', choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'rec-data', type: 'function', function: { name: options.opportunityModel?'select_campaign_product':'propose_campaign_changes', arguments: options.opportunityModel?JSON.stringify({variantId:'variant-a',headline:'Camisa de algodão',primaryText:'Conheça a camisa da loja',evidenceFields:['stockQuantity']}):'{"recommendations":[]}' } }] } }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } })); }
    if (String(url).startsWith('https://graph.facebook.com/v26.0/act_100')) return new Response(JSON.stringify({ id: '100', currency: 'BRL', is_prepay_account: false, balance: '0', funding_source: 'payment-a', account_status: 1, disable_reason: 0 }));
    if (String(url) !== 'https://mcp.facebook.com/ads') throw new Error('unexpected external request');
    const rpc = JSON.parse(String(init?.body)); if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result: unknown;
    const names = ['ads_get_ad_accounts', 'ads_get_field_context', 'ads_get_ad_entities', 'ads_create_campaign', 'ads_create_ad_set', 'ads_create_creative', 'ads_create_ad', 'ads_update_entity', 'ads_activate_entity'];
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'controlled-meta', version: '1' } };
    else if (rpc.method === 'tools/list') result = { tools: names.map(name => ({ name, inputSchema: { type: 'object', properties: {}, additionalProperties: true } })) };
    else {
      const args = rpc.params.arguments, name = rpc.params.name; let body: unknown;
      if (name === 'ads_get_ad_accounts') body = { ad_accounts: [{ ad_account_id: '100', ad_account_name: 'Conta da loja', currency: 'BRL', is_queryable: true, is_ads_mcp_enabled: true, has_payment_method: true, min_daily_budget_cents: options.minimumDailyBudgetCents??100 }] };
      else if (name === 'ads_get_field_context') body = { fields: args.field_names.map((name: string) => ({ name, levels: ['campaign', 'adset', 'ad', 'ad_account'], type: name.includes('budget') || ['amount_spent', 'spend_cap'].includes(name) ? 'CURRENCY' : 'STRING', filterable: true, supported_filter_operators: ['IN'] })), unknown_fields: [] };
      else if (name === 'ads_get_ad_entities') body = { ad_entities: JSON.stringify([{ id: args.level === 'account' ? '100' : args.level === 'adset' ? '300' : args.level === 'ad' ? '500' : '200', account_id: '100', campaign_id: '200', adset_id: '300', status: 'PAUSED', effective_status: 'PAUSED', targeting: {}, creative_id: '400', timezone_name: 'America/Sao_Paulo', lifetime_budget: { value: 100, unit: 'BRL' }, daily_budget: { value: 0, unit: 'BRL' }, amount_spent: { value: 0, unit: 'BRL' }, offsite_conversion_fb_pixel_purchase_values: { value: 0, unit: 'BRL' }, offsite_conversion_fb_pixel_purchase: 0, 'actions:onsite_conversion.messaging_conversation_started_7d': 0 }]) };
      else if (name === 'ads_update_entity') { writes.push(name); body = { success: true }; }
      else throw new Error('unexpected controlled MCP action');
      result = { structuredContent: { ...body as object, client_conversation_id: args.client_conversation_id }, content: [] };
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  };
  const makeAssistant=()=>createMerchantAssistantRuntime({ prisma: f.prisma, memberships, tenant, governance: { authorize: async (context,kind,resource) => { const identity = tenant.get()!; identities.push({ userId: identity.userId, role: identity.role, source: context.source });if(kind==='tool'&&deniedTools.has(resource))throw Object.assign(new Error('controlled grant denial'),{code:'assistant_tool_forbidden',status:403}); return {} as never; } }, env, transport, clock: f.clock });
  const assistant=makeAssistant();
  const product = new ProductEntity({ id: 'product-a', merchantId: 'store-a', name: 'Camisa', description: 'Algodão', type: 'physical', isActive: true, createdAt: f.clock(), updatedAt: f.clock(), variants: [{ id: 'variant-a', sku: 'CA', attributes: {}, isActive: true, basePriceInCents: 9900, costInCents: 0, taxPercent: 0, currency: 'BRL', stockQuantity: 8, stockReserved: 0, media: [{ id: 'image-a', url: 'https://media.example.test/camisa.png', type: 'IMAGE', order: 0 }] }] });
  const runtimeInput = { prisma: f.prisma, catalog: { findByVariantIds: async () => [product], search: async () => ({ products: [product] }) } as unknown as ProductRepositoryPort,
    merchants: { getProfile: async (id: string) => ({ id, name: 'Loja', slug: 'loja-a', storeSettings: { company: { email: 'owner@example.test' } } }) } as unknown as MerchantRepository,
    billing: { getBilling: async (merchantId: string) => ({ merchantId, status: 'active', planKey: 'growth' }) } as unknown as PaymentPlatformRepository,
    whatsapp: { findByMerchantId: async () => null } as unknown as WhatsAppConfigRepository, storage: { isConfigured: () => !!env.META_ADS_IMAGE_API_KEY, upload: async () => { throw Error('not used'); } }, env, assistant, memberships, request: transport, clock: f.clock };
  const makeRuntime=()=>createMetaAdsRuntime({...runtimeInput,assistant:makeAssistant()}),runtime=createMetaAdsRuntime(runtimeInput);
  const create = async () => {
    const campaign = await runtime.service.campaigns.create('store-a', { name: 'Campanha', destination: 'store', priority: 'roas', variantIds: ['variant-a'], country: 'BR', headline: 'Camisa', primaryText: 'Conheça a camisa', mediaIds: [], budget: { amountCents: 10000, currency: 'BRL', cadence: 'lifetime', startsAt: f.clock().toISOString(), endsAt: '2026-11-23T12:00:00.000Z' } }, 'runtime-campaign');
    const version = campaign.products[0].commercialVersion;
    await f.repo.mutate('store-a', [], state => { state.media['runtime-media'] = { id: 'runtime-media', campaignId: campaign.id, productId: 'product-a', variantId: 'variant-a', productVersion: version, url: 'https://media.example.test/verified.png', createdAt: f.clock().toISOString(), commercialReview: { status: 'verified', productVersion: version, imageSha256: 'a'.repeat(64), reviewedAt: f.clock().toISOString() } }; Object.assign(state.campaigns[campaign.id], { remoteCampaignId: '200', remoteAccountId: '100', remoteAdSetId: '300', remoteAdIds: ['500'], remoteCreativeIds: ['400'], status: 'remote_paused' }); state.campaigns[campaign.id].draft.mediaIds = ['runtime-media']; return { result: null }; }); return (await f.repo.read('store-a')).campaigns[campaign.id];
  };
  const policy = async (campaignId: string, allowNewCampaigns = false) => { const review = await runtime.policies.review('store-a', 'owner-a', { scope: { variantIds: ['variant-a'], campaignIds: [campaignId], allowNewCampaigns, destination: 'store', priority: 'roas', country: 'BR', actions: ['prepare', 'publish', 'pause', 'budget', 'creative'] }, limits: { currency: 'BRL', cadence: 'lifetime', campaignCeilingCents: 10000, storeCeilingCents: 20000, startsAt: f.clock().toISOString(), endsAt: '2026-11-23T12:00:00.000Z' } }); return (await runtime.policies.accept('store-a', 'owner-a', { scope: review.scope, limits: review.limits, version: review.version, digest: review.digest, idempotencyKey: 'runtime-policy' })).policy!; };
  const price = async () => { await f.sql.query('CREATE TABLE ai_price_versions(id TEXT PRIMARY KEY,provider TEXT,model TEXT,channel TEXT,component TEXT,currency TEXT,input_micros_per_million BIGINT,output_micros_per_million BIGINT,rates JSONB,effective_from TIMESTAMPTZ,effective_to TIMESTAMPTZ)'); await f.sql.query(`INSERT INTO ai_price_versions VALUES ('p','openai','gpt-4o-mini','chat','text_generation','USD',10000,20000,'{"input":"10000","output":"20000"}','2026-01-01',NULL)`); };
  return { ...f, assistant, runtime, makeRuntime, env, tenant, identities, requests, writes, create, policy, price,denyTool:(name:string)=>{deniedTools.add(name);},allowTool:(name:string)=>{deniedTools.delete(name);}, aiCalls: () => aiCalls, role: (value: boolean) => { role = value; }, close: async () => { await assistant.worker.onModuleDestroy(); await runtime.observation.onModuleDestroy(); await runtime.automatic?.onModuleDestroy();await runtime.opportunityWorker?.onModuleDestroy();await runtime.generationWorker.onModuleDestroy();await runtime.launches?.onModuleDestroy();await runtime.preparationWorker?.onModuleDestroy();await runtime.noticeWorker?.onModuleDestroy(); await f.close(); } };
}
