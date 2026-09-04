# ADR-012 — LLM safety gets a second-pass judge

**Status:** PROPOSED (P1)
**Module:** `agent-rules` + `checkout/safe-generated-message.ts`
**Issue:** P1-009

---

## Context

`apps/api/src/modules/checkout/domain/types/safe-generated-message.ts:60` is a regex-only blacklist of pt-BR discount/shipping/payment/CVV phrases. Ambiguous phrasings ("vou liberar uma condição especial") can slip. No semantic judge.

CLAUDE.md invariant: "Unsafe generated messages must fall back to deterministic safe templates." Deterministic fallback exists. This ADR strengthens the *detection* layer, not the fallback.

---

## Decision

Add second-pass LLM-judge for any reply containing currency-adjacent terms (`R$`, `%`, "liberar", "aprovado", "desconto"). Only used when primary regex hits or terms detected. Cost gate: max 1 LLM call per agent reply.

Fallback path: if LLM-judge times out, default to `generateDeterministicReply()` (current behavior).

---

## Implementation Steps

1. New service `LlmSafetyJudge` in `apps/api/src/modules/checkout/infrastructure/services/llm-safety-judge.service.ts`.
2. Heuristic gate: regex matches OR currency-adjacent terms found → run judge.
3. Judge prompt: "Does this reply claim any discount, free shipping, delivery guarantee, stock guarantee, payment confirmation, or request CVV/password? Reply yes/no."
4. Pipeline: OpenAI conversation adapter → regex → optional judge → sanitize → final.

---

## Files Touched

- `apps/api/src/modules/checkout/infrastructure/services/llm-safety-judge.service.ts` (new)
- `apps/api/src/modules/checkout/infrastructure/adapters/openai-conversation.adapter.ts`
- `apps/api/src/modules/checkout/infrastructure/adapters/langgraph-conversation.adapter.ts`
- `apps/api/src/modules/checkout/application/use-cases/send-chat-message.use-case.ts:167,346,351`
- `apps/api/src/modules/post-sale/application/services/post-sale-ai-copywriter.service.ts:289`
- Tests + eval fixtures
