# Tasks: Storefront Agent/Adapter Refactor

Gate after every task: `cd apps/api && pnpm build`. Specs at T8.

## T1 — Prompt builder extraction (R4)
- What: Move `buildDefaultSystem` from agent → `domain/prompts/store-system-prompt.builder.ts` as pure `buildStoreSystemPrompt(input)`. Include buyer-identity note + review instruction assembly. Agent imports it.
- Done when: agent no longer defines the prompt string inline; content byte-identical.
- Gate: build.

## T2 — Copy service (R5)
- What: Extract `generateVariantCopy` (+ nudge copy) → `infrastructure/copy/agent-copy.service.ts`. Adapter uses it.
- Gate: build.

## T3 — tool-context type (R1)
- What: Add `domain/tools/tool-context.ts` with `ToolRequestContext`. Adapter builds it per request in `reply()`.
- Gate: build.

## T4 — Extract product + cart handlers (R2) [P after T3]
- What: `tool-handlers/product.handlers.ts` + `cart.handlers.ts` factories taking deps + ctx. Adapter composes.
- Done when: those handlers no longer inline in adapter; use ctx not `this.current*`.
- Gate: build.

## T5 — Extract review + order + wishlist + support handlers (R2)
- What: `review.handlers.ts`, `order.handlers.ts`, `wishlist.handlers.ts`, `support.handlers.ts`. `tool-handlers/index.ts` composes all groups into `StoreToolHandlers`.
- Gate: build.

## T6 — Deterministic shortcuts service (R3)
- What: Move reply() bypasses → `domain/services/deterministic-shortcuts.service.ts` `resolveDeterministicShortcut(...)`. reply() calls it first.
- Gate: build.

## T6b — Split store-tools.ts one file per tool (R8)
- What: Break `domain/tools/store-tools.ts` (903L) into:
  - `domain/tools/types.ts` — `ToolDefinition`, `ExecutableTool`, `StoreToolHandlers`, `StoreToolContext`, `wrapHandler`.
  - `domain/tools/definitions/<tool-name>.tool.ts` — ONE file per tool, each holding its `ToolDefinition` schema + its `createXTool(ctx)` executable wrapper (co-located by tool). ~31 files, each <120L.
  - `domain/tools/index.ts` — `buildStoreTools()` (aggregates definitions) + `buildExecutableStoreTools(ctx)` (aggregates create*Tool). Barrel re-exports types so existing `from ".../store-tools.js"` imports keep working (or update importers).
- Done when: each tool file <120L; `store-tools.ts` reduced to a re-export barrel or removed; no file >500L.
- Gate: build.
- Depends on: T5.

## T7 — Thin adapter + remove instance state (R1, R6)
- What: adapter becomes orchestrator: build ctx → compose handlers → shortcut-or-run → post-process. Remove `currentMerchantId/currentSessionId/currentBuyer` fields. Wire new providers in `storefront.module.ts`. agent.run() accepts per-request handlers.
- Done when: adapter <500L (target <300), agent <500L, 0 mutable request-state fields.
- Gate: build.

## T8 — Verify (R7)
- What: `pnpm build` + run storefront/support specs via compiled test-runner. Assert no file >500L in touched set. Confirm prompt content unchanged (diff the string).
- Depends on: T1–T7.

## Traceability
| Req | Tasks |
|---|---|
| R1 | T3,T4,T7 |
| R2 | T4,T5 |
| R3 | T6 |
| R4 | T1 |
| R5 | T2 |
| R6 | T7 |
| R7 | T8 |
| R8 (tools split) | T6b |
