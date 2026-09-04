# Spec: Storefront Agent/Adapter Refactor (SOLID + Clean Arch)

## Goal

Decompose the inflated storefront conversation infrastructure into cohesive, single-responsibility units following the project's Clean Architecture (domain / application / infrastructure). Behavior-preserving.

Note: MVVM is a frontend pattern. The API is NestJS Clean/DDD. This refactor targets the equivalent backend separation: thin orchestrators, extracted services, pure builders, isolated tool handlers.

## Targets (inflated files)

| File | Lines | Problem |
|---|---|---|
| `infrastructure/adapters/storefront-conversation.adapter.ts` | 1203 | God object: 31 tool handlers inline + reply (with ~350L deterministic shortcuts) + nudge + variantCopy + mutable instance state (`currentMerchantId/currentSessionId/currentBuyer`) |
| `infrastructure/agents/store-langgraph-agent.ts` | 882 | run() + ~145L inline system-prompt string builder + safety + routing mixed |
| `domain/tools/store-tools.ts` | 903 | Tool schema catalog (large but cohesive — lower priority) |

## Requirements

### R1 — Eliminate mutable instance state (SOLID: SRP, thread-safety)
- R1.1: Remove `currentMerchantId`, `currentSessionId`, `currentBuyer` instance fields from the adapter.
- R1.2: Tool handlers receive their context (merchantId, sessionId, buyer) as explicit parameters, not via `this`.

### R2 — Extract tool handlers (SRP)
- R2.1: The 31 inline tool handlers move into cohesive handler groups under `infrastructure/tool-handlers/` (e.g. `product.handlers.ts`, `cart.handlers.ts`, `review.handlers.ts`, `support.handlers.ts`, `order.handlers.ts`, `wishlist.handlers.ts`).
- R2.2: Each group is a factory taking its dependencies + a `ToolContext` and returning the relevant slice of `StoreToolHandlers`.
- R2.3: The adapter composes the groups into the full `StoreToolHandlers` object.

### R3 — Extract deterministic shortcuts from reply()
- R3.1: The deterministic bypasses in `reply()` (Ofertas, Ver produtos, Detalhes {nome}, etc.) move into a `application`/`domain` service (`deterministic-shortcuts.service.ts`) returning an optional output.
- R3.2: `reply()` becomes a thin orchestrator: try shortcut → else run agent → post-process.

### R4 — Extract system-prompt builder from agent (SRP)
- R4.1: `buildDefaultSystem` (~145L) moves to `domain/prompts/store-system-prompt.builder.ts` as a pure function.
- R4.2: The buyer-identity note and review instruction live in the builder, not inline in run().

### R5 — Extract copy generation
- R5.1: `generateVariantCopy` and `generateNudge` copy logic move to a `copy` service (`infrastructure/copy/agent-copy.service.ts` or reuse).

### R6 — File size + SOLID
- R6.1: No resulting file over 500 lines (target <300).
- R6.2: Each unit has one reason to change (SRP). Dependencies flow inward (domain has no infra imports).

### R8 — Split store-tools.ts one file per tool
- R8.1: Each tool (schema + executable wrapper) lives in its own file under `domain/tools/definitions/`.
- R8.2: Shared types move to `domain/tools/types.ts`; `domain/tools/index.ts` aggregates `buildStoreTools()` + `buildExecutableStoreTools(ctx)`.
- R8.3: Existing importers of `store-tools.js` keep working (barrel re-export) or are updated.

### R7 — Verification
- R7.1: `pnpm build` (api) passes after each phase.
- R7.2: Existing storefront/support specs still pass.
- R7.3: No behavior change: same tools, same outputs, same prompt content.

## Non-Goals
- No new features. No prompt wording changes (only relocation).
- store-tools.ts schema split is optional (P2) — only if time permits.
- No changes outside the storefront module (except shared types if a context type is shared).

## Constraints
- NestJS DI: extracted services are providers wired in `storefront.module.ts`.
- Domain stays pure (no NestJS/prisma imports in domain builders).
- ESM `.js` import suffixes (project convention).

## Acceptance
- adapter < 500L, agent < 500L.
- 0 mutable request-state instance fields in adapter.
- Tool handlers isolated by concern.
- build + specs green.
