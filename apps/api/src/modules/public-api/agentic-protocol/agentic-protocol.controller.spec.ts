import test from 'node:test';
import assert from 'node:assert/strict';
import { AgenticProtocolController } from './agentic-protocol.controller.js';
import { GetAgentRulesUseCase } from '../../agent-rules/application/agent-rules.use-cases.js';
import type { AgentRulesRepository } from '../../agent-rules/domain/ports/agent-rules-repository.port.js';
import { AgentRulesEntity } from '../../agent-rules/domain/entities/agent-rules.entity.js';
import type { ProductFeedService } from './product-feed.service.js';
import type { AcpCheckoutLifecycleService } from './acp-checkout-lifecycle.service.js';

const feedServiceStub = {} as ProductFeedService;
const lifecycleStub = {} as AcpCheckoutLifecycleService;

const EXPECTED_SCOPES_BY_CAPABILITY: Record<string, string[]> = {
  checkout: ['checkout:start', 'checkout:track', 'checkout:complete'],
  offers: ['offers:apply', 'coupons:apply'],
  payment: [
    'payment:intents:create',
    'payment:intents:confirm',
    'payment:intents:read',
  ],
  'post-sale': ['post-sale:schedule', 'post-sale:review', 'post-sale:win-back'],
};

function createInMemoryRepository(): AgentRulesRepository {
  const store = new Map<string, ReturnType<AgentRulesEntity['snapshot']>>();
  return {
    async getDefault(merchantId: string) {
      return store.get(`${merchantId}:default`);
    },
    async getByAgentId(merchantId: string, agentId: string) {
      return store.get(`${merchantId}:${agentId}`);
    },
    async save(rules) {
      store.set(`${rules.merchantId}:${rules.agentId}`, rules);
      return rules;
    },
  };
}

const startCheckoutStub = {} as never;
const variantLookupStub = {} as never;

test('AgenticProtocolController returns canonical agent card with all capabilities', async () => {
  const repo = createInMemoryRepository();
  const useCase = new GetAgentRulesUseCase(repo);
  const controller = new AgenticProtocolController(
    useCase,
    feedServiceStub,
    startCheckoutStub,
    lifecycleStub,
    variantLookupStub,
  );

  const card = await controller.getAgentCard('merchant_xyz');

  assert.equal(card.version, '1.0');
  assert.equal(card.agent.id, 'aacp-merchant-agent-merchant_xyz');
  // Fresh merchant resolves to the platform default agent identity ("Zion"),
  // supplied by AgentRulesEntity.createDefault(). The controller only falls
  // back to AACP_PLATFORM_NAME when identity.agentName is empty (never for a
  // default entity).
  assert.equal(card.agent.name, 'Zion');
  assert.ok(card.agent.description.length > 0);
  assert.equal(typeof card.created_at, 'string');
  assert.ok(!Number.isNaN(Date.parse(card.created_at)));

  assert.deepEqual(
    card.capabilities.map((c) => c.name).sort(),
    ['checkout', 'offers', 'payment', 'post-sale'],
  );
  for (const cap of card.capabilities) {
    assert.deepEqual(
      cap.scopes,
      EXPECTED_SCOPES_BY_CAPABILITY[cap.name],
      `scopes mismatch for capability ${cap.name}`,
    );
  }

  assert.deepEqual(card.endpoints, {
    checkout_sessions: '/v1/acp/checkout_sessions',
    products_feed: '/v1/acp/products/feed',
    webhooks: '/v1/acp/webhooks',
  });
});

test('AgenticProtocolController is tenant-scoped — different merchant → different agent_id', async () => {
  const repo = createInMemoryRepository();
  const useCase = new GetAgentRulesUseCase(repo);
  const controller = new AgenticProtocolController(
    useCase,
    feedServiceStub,
    startCheckoutStub,
    lifecycleStub,
    variantLookupStub,
  );

  const cardA = await controller.getAgentCard('merchant_a');
  const cardB = await controller.getAgentCard('merchant_b');

  assert.equal(cardA.agent.id, 'aacp-merchant-agent-merchant_a');
  assert.equal(cardB.agent.id, 'aacp-merchant-agent-merchant_b');
  assert.notEqual(cardA.agent.id, cardB.agent.id);
});

test('AgenticProtocolController falls back to platform default when no merchant_id', async () => {
  const repo = createInMemoryRepository();
  const useCase = new GetAgentRulesUseCase(repo);
  const controller = new AgenticProtocolController(
    useCase,
    feedServiceStub,
    startCheckoutStub,
    lifecycleStub,
    variantLookupStub,
  );

  const card = await controller.getAgentCard(undefined);

  assert.equal(card.agent.id, 'aacp-merchant-agent-platform-default');
  // No merchant_id → default agent rules → default identity name "Zion".
  assert.equal(card.agent.name, 'Zion');
});

test('AgenticProtocolController picks up agent name from configured agent rules', async () => {
  const repo = createInMemoryRepository();
  const merchantId = 'merchant_with_name';
  await repo.save(
    AgentRulesEntity.createDefault({
      merchantId,
    }).update({
      identity: { agentName: 'Clara Prime' },
    }).snapshot(),
  );
  const useCase = new GetAgentRulesUseCase(repo);
  const controller = new AgenticProtocolController(
    useCase,
    feedServiceStub,
    startCheckoutStub,
    lifecycleStub,
    variantLookupStub,
  );

  const card = await controller.getAgentCard(merchantId);

  assert.equal(card.agent.name, 'Clara Prime');
  assert.equal(card.agent.id, `aacp-merchant-agent-${merchantId}`);
});
