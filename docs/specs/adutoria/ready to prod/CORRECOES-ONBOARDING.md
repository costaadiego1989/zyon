# API-030 — Transição de onboarding e outbox atômicos

Implementado localmente em `master`, em 2026-09-07.

`CompleteOnboardingStepUseCase` agora persiste o estado e os eventos `merchant.onboarding.step.completed` e `merchant.onboarding.completed` por uma porta transacional. A implementação Prisma executa o upsert de `merchant_onboarding_states` e o upsert idempotente da outbox na mesma transação. Uma falha em qualquer escrita faz rollback de ambas.

O ID do evento é derivado da transição lógica `(merchant, tipo, step)`, e não do horário da tentativa. Repetições não criam outro evento lógico. A validação de ordem e a resposta HTTP permanecem inalteradas.

Validação executada:

- `node --loader ./tests/ready-prod-loader.mjs --test ./src/modules/onboarding/application/onboarding.use-cases.spec.ts` — 12 testes passaram.
- `pnpm --filter @zyon/api build` — passou.

Não foi executado teste concorrente ou de rollback em PostgreSQL descartável. O status é `IMPLEMENTED_LOCAL_VALIDATION`; o gate de produção continua aberto até validar a transação e a entrega do outbox em banco real.