# Design: Storefront Agent/Adapter Refactor

## Architecture (project = NestJS Clean/DDD)

```
modules/storefront/
  domain/
    prompts/
      store-system-prompt.builder.ts     # R4 — pure fn, no infra
    services/
      deterministic-shortcuts.service.ts # R3 — pure-ish, returns optional output
    tools/
      store-tools.ts                      # existing (schemas)
      tool-context.ts                      # ToolRequestContext type
  infrastructure/
    tool-handlers/
      product.handlers.ts                  # searchProducts, getProductDetails, compareProducts, getProductAvailability, getSimilarProducts, listCategories, getDailyDeals
      cart.handlers.ts                     # addItemToCart, getCart, removeCartItem, updateCartItem, clearCart, quoteShipping, applyCoupon, removeCoupon, listPromotions, createCheckoutSession
      review.handlers.ts                   # getReviews, createReview, getProductQuestions, createQuestion
      order.handlers.ts                    # trackOrder, getInvoice, cancelOrder, getStorePolicies, getBuyerProfile
      wishlist.handlers.ts                 # addToWishlist, getWishlist, removeFromWishlist
      support.handlers.ts                  # getFaq, escalateToHuman
      index.ts                             # composeStoreToolHandlers(deps, ctx)
    copy/
      agent-copy.service.ts                # generateVariantCopy + nudge copy
    adapters/
      storefront-conversation.adapter.ts   # THIN orchestrator (<300L)
    agents/
      store-langgraph-agent.ts             # run() only, prompt via builder (<500L)
```

## Key SOLID fix — request-scoped context (R1)

Current anti-pattern: handlers close over `this.currentMerchantId/currentSessionId/currentBuyer`, mutated per request in `reply()`. Not SRP, not concurrency-safe.

New: a plain `ToolRequestContext` object created **per request** inside `reply()` and passed to the handler factories:

```ts
export interface ToolRequestContext {
  merchantId: string;
  sessionId: string;
  buyer?: { globalUserId: string; name?: string; phone?: string; email?: string };
}
```

Handler factory shape:
```ts
export function createCartHandlers(deps: CartHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "addItemToCart" | ...> { ... }
```

`reply()` builds `ctx` once per call, composes handlers, hands them to a per-request agent invocation. No instance mutation.

Because the agent is constructed once (constructor) but handlers are per-request, the agent's `run()` must accept the composed handlers/executable tools per call (or the adapter builds a lightweight per-request tool set). Design: `agent.run()` gains an optional `toolHandlers` param; when present it overrides the constructor default. Behavior identical.

## Prompt builder (R4)

`buildDefaultSystem(...)` → `buildStoreSystemPrompt(input): string` in `domain/prompts/`. Pure. Takes merchantName, storeCategory, storeSettings, agentIdentity, merchantPolicy, advancedRules, buyerContext. Returns the full system string (same content, relocated). The buyer-identity note + review instruction are assembled here.

## Deterministic shortcuts (R3)

`resolveDeterministicShortcut(input, deps): Promise<StorefrontConversationOutput | null>`. Encapsulates the Ofertas / Ver produtos / Detalhes {name} bypasses. `reply()` calls it first; if non-null, returns it; else runs the agent.

## Migration order (behavior-preserving, build after each)

1. `tool-context.ts` type + prompt builder extraction (agent shrinks). Build.
2. Extract copy service. Build.
3. Extract tool handler groups one-by-one; adapter composes. Build after each group.
4. Extract deterministic shortcuts service. Build.
5. Thin adapter + remove instance state. Build.
6. Full build + specs.

## Risk controls
- Move code verbatim; do not rewrite tool logic.
- Keep `StoreToolHandlers` shape unchanged.
- Prompt string content byte-identical (relocated only).
- Build + specs after every phase.
- One phase per commit.
