# ADR 0001 (audit) — Arquitetura do módulo audit e durabilidade do trilho de auditoria

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Audit), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0028](../../../../../../../docs/architecture/adr/0028-merchant-console-integration-api-v1.md). Código: `apps/api/src/modules/audit/**`, interceptor de idempotência `apps/api/src/shared/http/idempotency/idempotency.interceptor.ts`.

## Contexto

`audit` registra o trilho de ações privilegiadas dos tenants. Componentes:

- **`AuditMutationInterceptor`** (`infrastructure/audit-mutation.interceptor.ts`) — registrado como `APP_INTERCEPTOR` global. Em requests `POST/PUT/PATCH/DELETE` com `tenantPrincipal` presente, deriva `resourceType`/`resourceId` da rota e grava o evento via `RecordAuditEventUseCase`.
- **Application:** `RecordAuditEventUseCase` (grava por `principal.tenantId`, ator humano/serviço), `ListAuditEventsUseCase` (paginação keyset por `AuditCursor` base64url).
- **Domain/Infra:** port `AuditRepository`, `PrismaAuditRepository`, `AuditEventsController` (`GET` por escopo).

O `IdempotencyInterceptor` também é `APP_INTERCEPTOR` global; num replay emite o corpo cacheado via `of(replayBody)` e seta o header `Idempotency-Replayed: true`.

**Invariantes:**
1. Ação privilegiada que muda estado deve deixar trilho durável (compliance/forense).
2. `merchant_id`/ator derivados do `tenantPrincipal` autenticado (ADR 0005/0009).
3. Um request que não fez trabalho (replay no-op) não deve gerar evento de auditoria novo.

## Decisão

Tornar a gravação de auditoria **observável quanto a falhas** e, no alvo, **durável e atômica** com a mutação auditada, e **suprimir gravação em replays idempotentes**. Concretamente:

- Em vez de engolir o erro, no mínimo logar/emitir métrica em falha de gravação; alvo: persistir auditoria via outbox transacional (ADR 0003) commitando junto com a mutação auditada, ou buffer-and-retry.
- Detectar replay (header `Idempotency-Replayed`) e pular a gravação, ou ordenar os interceptors para auditoria rodar dentro do boundary de idempotência só na primeira execução.

## Bugs encontrados e remediação decidida

### P2 — Gravação de auditoria é fire-and-forget com erro engolido — trilho não durável
- **Arquivo:** `infrastructure/audit-mutation.interceptor.ts:38-52`.
- **Causa raiz:** o interceptor grava dentro de `tap({ next })` com `void this.recordAudit.execute(...).catch(() => undefined)`. Qualquer falha (DB fora, validação) é descartada em silêncio; o write não é aguardado nem transacional com a mutação que audita.
- **Impacto:** registros de auditoria de compliance/segurança podem ser perdidos silenciosamente enquanto a mutação subjacente tem sucesso, deixando ações privilegiadas sem rastro. O trilho não é confiável para forense. Quebra invariante 1.
- **Remediação:** no mínimo logar/emitir métrica em falha em vez de engolir; preferencialmente persistir auditoria via outbox transacional (ADR 0003), commitando atômico com a mutação, ou buffer-and-retry. Decidir garantias de durabilidade explicitamente. **Não precisa de contrato.** Caminho durável via outbox alinha com ADR 0003/0009 (sem migração obrigatória se `OutboxMessage` já existe no schema).

### P3 — Interceptor de auditoria registra em duplicidade em respostas de replay idempotente
- **Arquivo:** `infrastructure/audit-mutation.interceptor.ts:36-53`.
- **Causa raiz:** `AuditMutationInterceptor` e `IdempotencyInterceptor` são ambos `APP_INTERCEPTOR` globais. Num replay idempotente o `IdempotencyInterceptor` emite o corpo cacheado via `of(replayBody)`, que ainda dispara o `tap({ next })` da auditoria, gravando um evento novo para um request que não fez trabalho.
- **Impacto:** log de auditoria infla com entradas duplicadas para requests replayados (no-op), poluindo o trilho e métricas de volume/taxa derivadas dele. Quebra invariante 3.
- **Remediação:** detectar replay (header `Idempotency-Replayed` setado pelo interceptor de idempotência) e pular a gravação, ou ordenar os interceptors para que a auditoria rode dentro do boundary de idempotência só na primeira execução. **Não precisa de contrato nem migração.**

## Melhorias para produção

### Segurança
- `merchant_id`/ator sempre do `tenantPrincipal` (ADR 0005/0009); auditoria cobre todas as mutações com principal.

### Desacoplamento
- Auditoria durável via outbox transacional (ADR 0003) em vez de fire-and-forget acoplado ao `tap`.

### Persistência & Consistência
- Write de auditoria atômico com a mutação (outbox) ou buffer-and-retry; supressão de gravação em replay.

### Observabilidade
- Métrica/log em falha de gravação de auditoria (hoje engolida); métrica de eventos por ação/tenant não inflada por replays.

### Otimização & Escala
- Paginação keyset já presente (`AuditCursor`); índice por `(merchant_id, occurred_at, id)` nas listagens.

### Features faltantes
- Garantia de durabilidade documentada (RPO do trilho); runbook de reconciliação auditoria↔mutação; alerta sobre gap de auditoria.

## Alternativas consideradas
- **Manter fire-and-forget e aceitar perda eventual.** Rejeitado: viola a função de compliance/forense do trilho.
- **Auditoria síncrona bloqueante no caminho da mutação sem outbox.** Rejeitado: acopla latência/disponibilidade da mutação ao banco de auditoria; outbox dá atomicidade sem acoplamento de disponibilidade.

## Consequências
**Positivas:** trilho confiável e auditável; sem inflar com replays; falhas visíveis.
**Negativas/riscos:** caminho durável via outbox aumenta superfície de teste; ordenar/instrumentar interceptors exige cuidado com a cadeia global de `APP_INTERCEPTOR`.

**Barra de aceite:** falha de gravação de auditoria gera métrica/log (não silenciosa); replay idempotente não cria evento de auditoria novo; no alvo, auditoria commitada atômica com a mutação em banco real.
