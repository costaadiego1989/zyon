# Preserve the current shopping turn

**Approved**: 2026-11-04 - prior authorization to correct and publish the final WhatsApp/storefront flow; user: "prossiga".

## Problem

The live FAQ/policy conversation retrieved current public knowledge but greeted instead of answering. The full system guide exceeded the history budget, so ContextManager retained system instructions and discarded the current user question. The existing shared library behavior is preserved; the storefront agent guarantees its current turn after trimming optional history.

## Requirements

- CT-01: Every admitted storefront/WhatsApp narration request contains the full current buyer question and extracted attachment context, even when mandatory system instructions exhaust the history budget.
- CT-02: A question already retained by ContextManager is not duplicated. System instructions and current support-read evidence remain intact.
- CT-03: Input domain admission and canonical support-read failures keep their existing controls. This repair grants no cart, payment or support mutation authority.

## Execution

1. Reproduce the lost current question in the existing support agent test. RED recorded on 2026-11-04 before implementation.
2. Restore the current turn only when absent from the trimmed messages; verify the two channels and normal/overflow budgets.
3. Commit, independently verify, run focused tests, production TypeScript and the release regression; publish exact source and repeat actual FAQ/policy conversations.

## Checks

**C1** - Full current question, one copy, mandatory evidence, both channels (CT-01/CT-02)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/agents/support-rag-current-read.spec.ts`

**C2** - Domain and output scope are still enforced (CT-03)
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/agents/storefront-scope-agent.spec.ts ./apps/api/src/modules/storefront/infrastructure/agents/storefront-output-scope.spec.ts`

**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`

## Handoff

**Dispatched:** not yet; wait for the final source commit and prerequisite proof.

Production API5a9e935b serves sourcecda409ff8 with support-read repair but still drops the current question. Both live failures are retained under .audit/graph-rag-cypher-20261103/storefront-released{Policy,Faq}-failure.json. No WhatsApp message was sent during access recovery, and the known encrypted draft was not changed.
