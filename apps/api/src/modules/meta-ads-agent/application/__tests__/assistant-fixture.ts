import { readFile } from 'node:fs/promises';
import type { MetaAdsProduct } from '@zyon/shared-types';
import { PrismaAssistantRepository } from '../../../merchant-assistant/infrastructure/prisma-assistant.repository.js';
import { TurnAdmissionService } from '../../../merchant-assistant/application/turn-admission.service.js';
import { AssistantError, type AssistantScope } from '../../../merchant-assistant/domain/assistant.port.js';
import { readOffer } from '../../domain/offer.js';
import { BillingService } from '../billing.service.js';
import { CampaignService } from '../campaign.service.js';
import { ConnectionService } from '../connection.service.js';
import { GenerationService } from '../generation.service.js';
import { ProposalService } from '../proposal.service.js';
import { ExecutionService } from '../execution.service.js';
import { MetaAdsAgentService } from '../meta-ads-agent.service.js';
import { MetaAdsAssistantAdapter } from '../meta-ads-assistant.adapter.js';
import { applicationFixture } from './fixture.js';

export const assistantProduct: MetaAdsProduct = { productId: 'product-a', variantId: 'variant-a', name: 'Camisa', description: 'Algodão', sku: 'CA', imageUrl: 'https://media.example.test/camisa.png', priceCents: 9900, currency: 'BRL', stockQuantity: 8, active: true, storefrontUrl: 'https://store.example.test/camisa', commercialVersion: 'version-a' };
export const assistantScope: AssistantScope = { merchantId: 'store-a', actorId: 'owner-a', context: 'meta-ads' };
export async function metaAssistantFixture() {
  const f = await applicationFixture();
  await f.sql.query(await readFile(new URL('../../../../../prisma/migrations/20261116103000_merchant_assistant/migration.sql', import.meta.url), 'utf8'));
  const conversations = new PrismaAssistantRepository(f.prisma, f.clock);
  const catalogReads: string[] = [];
  f.commerce.products = async (merchantId, input) => { catalogReads.push(merchantId); return merchantId === 'store-a' && (!input?.variantIds || input.variantIds.includes('variant-a')) ? [structuredClone(assistantProduct)] : []; };
  const billing = new BillingService(f.repo, f.commerce, { quote: async () => { throw Error('unexpected billing'); }, createCheckout: async () => { throw Error('unexpected checkout'); }, cancelRenewal: async () => {}, verifiedEvent: async () => null }, () => readOffer({}), f.clock);
  const connection = new ConnectionService(f.repo, f.commerce, f.oauth, f.codec, f.provider, f.redirect, f.clock);
  const campaigns = new CampaignService(f.repo, f.commerce, connection, f.provider, f.clock);
  let physicalImages = 0;
  const generations = new GenerationService(f.repo, f.commerce, { configured: () => true, generate: async () => { physicalImages++; throw Error('not authorized in adapter test'); } }, f.clock);
  const proposals = new ProposalService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock);
  const executions = new ExecutionService(f.repo, f.commerce, campaigns, connection, f.provider, f.clock);
  const service = new MetaAdsAgentService(f.repo, f.commerce, billing, connection, campaigns, generations, proposals, executions, f.provider, {});
  const actor = async (scope: AssistantScope) => { if (scope.actorId !== 'owner-a' || scope.merchantId !== 'store-a') throw new AssistantError('assistant_forbidden', 403); };
  const governed: string[] = [];
  const adapter = new MetaAdsAssistantAdapter({ service, conversations, authorizeActor: actor, authorizeTool: async (_scope, name) => { governed.push(name); }, clock: f.clock });
  const admission = new TurnAdmissionService(conversations, scope => adapter.authorizeInvocation(scope), () => ({ turnMicros: 10000n, monthlyMicros: 100000n }), f.clock);
  const thread = await conversations.createThread(assistantScope);
  const { turn } = await admission.submit(assistantScope, thread.id, { message: 'Quero anunciar', expectedRevision: 0, idempotencyKey: 'request-a' });
  await conversations.atomic(assistantScope, thread.id, async tx => { await tx.update(turn.id, { status: 'running', leaseToken: 'lease-a', leaseUntil: new Date(f.clock().getTime() + 60000).toISOString() }); });
  const input = { scope: assistantScope, threadId: thread.id, turnId: turn.id, leaseToken: 'lease-a' };
  const call = (name: string, args: Record<string, unknown> = {}) => adapter.execute({ ...input, name, args });
  const connect = async () => {
    const begin = await connection.begin('store-a', 'owner-a');
    await connection.complete('store-a', 'owner-a', new URL(begin.authorizationUrl).searchParams.get('state')!, 'code-a');
    await connection.select('store-a', { accountId: '100', pageId: '110', datasetId: '120', whatsappId: '5511999999999' });
  };
  return { ...f, conversations, catalogReads, governed, adapter, admission, service, thread, turn, input, call, connect, physicalImages: () => physicalImages };
}
