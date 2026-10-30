import test from "node:test";
import assert from "node:assert/strict";
import { SendStoreMessageUseCase } from "./send-store-message.use-case.js";
import { PrismaMerchantAgentRuleReader } from "../../../agent-rules/infrastructure/merchant-agent-rule-reader.adapter.js";
import { StorefrontConversationAdapter } from "../../infrastructure/adapters/storefront-conversation.adapter.js";
import { createAllowedScopeAgent } from "../../infrastructure/agents/storefront-scope.fixture.js";
import { buildConversationBlocks } from "../../infrastructure/agents/conversation-block.builder.js";
import { storefrontConversationOutputSchema, STOREFRONT_CONTRACT_FALLBACK } from "../../domain/contracts/storefront-conversation.schemas.js";
import { shoppingSearchEvidence } from "../services/shopping-search-evidence.js";
import { shoppingSearchPlanSchema } from "../../domain/contracts/shopping-search-plan.schemas.js";

const input = { merchant_id: "merchant", conversation_id: "conversation", cart_id: "conversation",
  user_message: "Meu orçamento máximo é R$70. Mostre kits organizadores até esse valor, sem adicionar nem cobrar." };
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
const wire = { schemaVersion: 1, plan: { version: 1, query: "kit organizador", minPriceCents: null,
  maxPriceCents: 7000, minRating: null, attributes: [], sortBy: null, delivery: null, unsupportedCriteria: [] } };

for (const nextCursor of [null, undefined, "canonical-next-page"] as const) {
  test(`eligible shopping result survives agent, adapter and use-case contracts with cursor ${String(nextCursor)}`, async () => {
    let reads = 0, plans = 0;
    const handlers = { recommendProducts: async ({ criteria }: any) => {
      reads++; assert.equal(criteria.maxPriceCents, 7000);
      return { products: [{ id: "essential", name: "Essencial", price: 6000, inStock: true }], nextCursor,
        searchEvidence: shoppingSearchEvidence(criteria, 1) };
    } };
    const agent = createAllowedScopeAgent({ structuredRouting: true, toolHandlers: handlers as never,
      provider: { chat: async () => { plans++; return { content: JSON.stringify(wire), usage }; } } as never },
      { domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", requiresTool: true, needsProductDiscovery: true });
    const merchant = { getProfile: async () => ({ name: "Loja", storeCategory: "others" }), getStoreSettings: async () => ({}) };
    const prisma = { agentRule: { findFirst: async () => null }, merchantRule: { findUnique: async () => null },
      checkoutSetting: { findUnique: async () => null }, promptExperiment: { findFirst: async () => null }, buyerAccount: { findUnique: async () => null } };
    const previousKey = process.env.LOCAL_LLM_API_KEY;
    process.env.LOCAL_LLM_API_KEY = "unit-unused-provider-key";
    let adapter: StorefrontConversationAdapter;
    try { adapter = new StorefrontConversationAdapter(merchant as never, {} as never, {} as never,
      { getOrCreate: async () => ({ items: [], total: 0 }) } as never, prisma as never, {} as never); }
    finally { if (previousKey === undefined) delete process.env.LOCAL_LLM_API_KEY; else process.env.LOCAL_LLM_API_KEY = previousKey; }
    // The real agent owns planning and projection; the adapter's unit-only
    // preparation replaces no output contract and performs no provider IO.
    (adapter as any).agent = { prepare: async (context: any) => ({ allowed: true,
      run: async () => agent.run({ ...context, toolHandlers: handlers }) }) };
    let projected: unknown;
    const conversation = { reply: async (context: any) => {
      projected = await adapter.reply(context);
      assert.equal(storefrontConversationOutputSchema.safeParse(projected).success, true);
      return projected;
    } };
    const usecase = new SendStoreMessageUseCase(merchant as never, conversation as never, prisma as never,
      new PrismaMerchantAgentRuleReader(prisma as never));
    const output = await usecase.execute(input);
    assert.notEqual(output.message, STOREFRONT_CONTRACT_FALLBACK); assert.match(output.message, /70,00/);
    assert.equal(output.blocks.length, 1); assert.equal(output.blocks[0]!.type, "product_carousel");
    const data = output.blocks[0]!.data as any;
    assert.equal(data.products[0].price, 6000); assert.equal(data.criteria.maxPriceCents, 7000);
    if (nextCursor == null) assert.equal(Object.hasOwn(data, "nextCursor"), false);
    else assert.equal(data.nextCursor, nextCursor);
    assert.equal(reads, 1); assert.equal(plans, 1);
  });
}

test("the display schema still rejects a malformed non-null cursor instead of silently dropping it", () => {
  const criteria = shoppingSearchPlanSchema.parse({ version: 1, query: "kit", maxPriceCents: 7000 });
  const built = buildConversationBlocks({ merchantId: "merchant", userMessage: input.user_message, finalContent: "Confira.",
    presentationMode: "structured", searchPurpose: "discovery", toolResults: { search_products: {
      products: [{ id: "essential", name: "Essencial", price: 6000, inStock: true }], nextCursor: 42,
      searchEvidence: shoppingSearchEvidence(criteria, 1),
    } } });
  assert.equal(storefrontConversationOutputSchema.safeParse({ message: built.finalContent, blocks: built.blocks }).success, false);
});
