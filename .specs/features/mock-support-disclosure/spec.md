# Disclose simulated support content

**Approved**: 2026-11-04 - user authorized mock FAQ/policies and continuation of production acceptance.

## Scope

The real storefront answers current support questions correctly after a61cf6d3e, but omits their simulation label. The agent must disclose when an answer is based on currently confirmed mock public FAQ/policies. Source/test changes stay in store-langgraph-agent.ts and support-rag-current-read.spec.ts.

## Requirements

- MOCK-01: A support answer with selected mock RAG, successful current mock FAQ/policy reads and only public support tools SHALL include a clear simulation notice, using italics on WhatsApp and plain text on storefront.
- MOCK-02: Ordinary or revoked mock sources SHALL NOT acquire a mock notice; failed current reads SHALL remain unconfirmed. An existing clear notice SHALL NOT be duplicated.
- MOCK-03: The notice SHALL pass through the existing safety and output-scope validation. It grants no action authority and does not annotate order/cart mutations.
- MOCK-04: If narration is rejected after confirmed public-only support reads, exactly one current FAQ matching the question MAY be quoted after the same safety validation and an independent output-scope review. Failed reads, ambiguous/unrelated FAQs, unsafe source text and scope rejection SHALL NOT emit that quotation. No tool or business action is retried.

## Execution

1. Add a deterministic notice for the bounded confirmed public support branch.
2. Verify both channel formats, ordinary/revoked/failed sources and existing notices.
3. Independently review, run release checks, publish exact source and repeat actual conversations, including the Pix explanation that returned a safety fallback in the live test.

## Checks

**C1** - Current simulation notice, both formats and negative source cases (MOCK-01/MOCK-02)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/agents/support-rag-current-read.spec.ts`

**C2** - Existing input/output scope remains enforced (MOCK-03)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/agents/storefront-scope-agent.spec.ts ./apps/api/src/modules/storefront/infrastructure/agents/storefront-output-scope.spec.ts`

**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`

## Handoff

**Dispatched:** pending prerequisite checks at final source HEAD.
